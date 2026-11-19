//! Explicit synthetic vocabulary/CPU validation. No discovery or network.
//! cargo run --release -p loklm-inference --example checked -- grammar|generate GGUF
use llama_cpp_2::{
    llama_backend::LlamaBackend,
    model::{LlamaModel, params::LlamaModelParams},
    sampling::LlamaSampler,
    token::{LlamaToken, data::LlamaTokenData, data_array::LlamaTokenDataArray},
};
use loklm_core::{
    comparison_answer::{ComparisonPassage, ComparisonPlan},
    context_budget::{self, ContextInput},
    qa::Language,
    session::{Sessions, Ticket},
};
use loklm_inference::{Model, ModelKind};
use serde_json::json;
use std::{path::Path, time::Instant};

fn admitted(model: &LlamaModel, grammar: &str, raw: &str, ticket: &Ticket) -> bool {
    let mut sampler = LlamaSampler::grammar(model, grammar, "root").unwrap();
    let end = model.vocab().tokenize(b"<|im_end|>", false, true);
    assert_eq!(end.len(), 1);
    assert!(model.vocab().is_eog(end[0]));
    let tokens = model.vocab().tokenize(raw.as_bytes(), false, false);
    for token in tokens.into_iter().chain(end) {
        ticket.check().unwrap();
        let mut candidates =
            LlamaTokenDataArray::new(vec![LlamaTokenData::new(token, 0.0, 0.0)], false);
        sampler.apply(&mut candidates);
        if !candidates.data[0].logit().is_finite() {
            return false;
        }
        // apply() does not accept; production sample() does. Never accept twice.
        sampler.try_accept(token).unwrap();
    }
    true
}
fn grammar(path: &Path, ticket: &Ticket) -> Result<(), Box<dyn std::error::Error>> {
    loklm_inference::verify_file(path, loklm_inference::QWEN4B_LOCAL_SHA, ticket)?;
    llama_cpp_2::send_logs_to_tracing(llama_cpp_2::LogOptions::default().with_logs_enabled(false));
    let backend = LlamaBackend::init()?;
    let model = LlamaModel::load_from_file(
        &backend,
        path,
        &LlamaModelParams::default()
            .with_n_gpu_layers(0)
            .with_vocab_only(true),
    )?;
    let source = ComparisonPassage {
        document_id: 7,
        chunk_id: 11,
        document_title: "Synthetic library".into(),
        text:
            "The synthetic library access code is ALPHA-47. Grüße 👋. Literal <think>data</think>."
                .into(),
    };
    let plan = ComparisonPlan::new(
        "What is the library access code?",
        std::slice::from_ref(&source),
    )
    .unwrap();
    let compiled =
        llama_cpp_2::json_schema_to_grammar(&serde_json::to_string(plan.json_schema())?)?;
    let raw = r#"{"check":"Use supplied evidence","result":{"resolution":"answered","blocks":[{"text":"ALPHA-47. Grüße 👋. Literal <think>data</think>.","sources":["7:11"]}]}}"#;
    assert!(admitted(&model, &compiled, raw, ticket));
    // Plain thinking tags are JSON string content, not a stream delimiter.
    assert!(plan.parse(raw, Language::En, 32000).is_err());
    // The renderer rejects active HTML; grammar deliberately does not claim to.
    let clean = raw.replace(" Literal <think>data</think>.", "");
    assert!(admitted(&model, &compiled, &clean, ticket));
    assert!(plan.parse(&clean, Language::En, 32000).is_ok());
    let invalid = [
        clean.replace("7:11", "8:12"),
        clean.replace("\"answered\"", "\"invented\""),
        clean.replace("\"check\":", "\"other\":"),
        clean[..clean.len() - 1].to_owned(),
        format!("{clean} trailing"),
        format!("<think>reasoning</think>{clean}"),
    ];
    for value in &invalid {
        assert!(!admitted(&model, &compiled, value, ticket));
    }
    let comparison = r#"{"check":"Compare records","result":{"resolution":"comparison","sources":["7:11"],"outcome":"unresolved"}}"#;
    assert!(admitted(&model, &compiled, comparison, ticket));
    assert!(plan.parse(comparison, Language::En, 32000).is_ok());
    // Validate both complete schema branches with actual pinned vocabulary.
    let summary =
        ComparisonPlan::new("Compare the records. Answer in one sentence.", &[source]).unwrap();
    assert_eq!(
        summary.comparison_mode(),
        loklm_core::comparison_answer::ComparisonMode::Summary
    );
    let summary_grammar =
        llama_cpp_2::json_schema_to_grammar(&serde_json::to_string(summary.json_schema())?)?;
    assert!(admitted(&model, &summary_grammar, &clean, ticket));
    // Make an invalid first token the higher-logit candidate: grammar must mask
    // it before greedy selection, as in the production chain.
    let good = model.vocab().tokenize(b"{", false, false);
    let bad = model.vocab().tokenize(b"X", false, false);
    assert_eq!((good.len(), bad.len()), (1, 1));
    let mut sampler = LlamaSampler::chain(
        [
            LlamaSampler::grammar(&model, &compiled, "root")?,
            LlamaSampler::greedy(),
        ],
        true,
    );
    let mut candidates = LlamaTokenDataArray::new(
        vec![
            LlamaTokenData::new(LlamaToken(bad[0].0), 100.0, 0.0),
            LlamaTokenData::new(good[0], -100.0, 0.0),
        ],
        false,
    );
    sampler.apply(&mut candidates);
    assert_eq!(candidates.selected_token(), Some(good[0]));
    println!(
        "{}",
        json!({"synthetic":true,"tensor_weights_loaded":false,
        "valid_documents":4,"invalid_documents":invalid.len(),"greedy_mask":true,
        "runtime":loklm_inference::CHECKED_GENERATION_VERSION,
        "model_sha256":loklm_inference::QWEN4B_LOCAL_SHA})
    );
    Ok(())
}
fn input(language: Language) -> ContextInput {
    serde_json::from_value(json!({"contextTokens":8192,"language":language,"answerMode":"checked",
        "question":match language { Language::En=>"What is the library access code?", Language::De=>"Wie lautet der Bibliothekscode?" },
        "hits":[{"document_id":7,"chunk_id":11,"document_title":"Synthetic library / Bibliothek",
            "text":"The synthetic library access code is ALPHA-47. Der synthetische Bibliothekscode lautet ALPHA-47.",
            "heading_path":["Access / Zugang"],"score":0.93,"origin":"primary"}]})).unwrap()
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() != 2 {
        return Err("Expected grammar|generate and explicit canonical Qwen4B GGUF".into());
    }
    let sessions = Sessions::default();
    sessions.publish(sessions.epoch())?;
    let ticket = sessions.ticket()?;
    if args[0] == "grammar" {
        return grammar(Path::new(&args[1]), &ticket);
    }
    if args[0] != "generate" {
        return Err("Unknown mode".into());
    }
    let model = Model::load(Path::new(&args[1]), ModelKind::Qwen4B, &ticket)?;
    let mut results = Vec::new();
    for language in [Language::En, Language::De] {
        let context =
            context_budget::plan(&input(language)).map_err(|_| "Synthetic context rejected")?;
        assert!(context.fits());
        let started = Instant::now();
        let generated = model.generate_checked(&context, language, &ticket)?;
        assert!(generated.parsed.answer.contains("ALPHA-47"));
        assert!(generated.parsed.answer.contains("[doc:7, chunk:11]"));
        results.push(json!({"language":language,"parsed":generated.parsed,
            "prompt_tokens":generated.prompt_tokens,"output_tokens":generated.output_tokens,
            "elapsed_ms":started.elapsed().as_millis()}));
    }
    let context =
        context_budget::plan(&input(Language::En)).map_err(|_| "Synthetic context rejected")?;
    assert!(
        model
            .generate_checked(&context, Language::De, &ticket)
            .is_err()
    );
    let passage = context.hits()[0].passage();
    let prompt = loklm_core::qa::build_prompt(
        "What is the library access code?",
        std::slice::from_ref(passage),
        &[],
        Language::En,
        &[],
        None,
    );
    let mut streamed = String::new();
    let basic = model.generate(
        loklm_core::qa::system_prompt(Language::En, loklm_core::qa::Depth::Concise, false),
        &prompt,
        256,
        &ticket,
        |part| {
            streamed.push_str(part);
            Ok(())
        },
    )?;
    assert_eq!(streamed, basic);
    assert!(basic.contains("ALPHA-47"));
    let citations = loklm_core::qa::validate_citations(&basic, std::slice::from_ref(passage))?;
    assert_eq!(citations.len(), 1);
    let cancel_ticket = ticket.clone();
    let started = Instant::now();
    let result = std::thread::scope(|scope| {
        scope.spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(150));
            cancel_ticket.cancel();
        });
        model.generate_checked(&context, Language::En, &ticket)
    });
    assert!(matches!(result, Err(loklm_core::Error::Revoked)));
    let cancel_elapsed_ms = started.elapsed().as_millis();
    let lock_ticket = sessions.ticket()?;
    let locking = sessions.clone();
    let started = Instant::now();
    let result = std::thread::scope(|scope| {
        scope.spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(150));
            locking.revoke();
        });
        model.generate_checked(&context, Language::En, &lock_ticket)
    });
    assert!(matches!(result, Err(loklm_core::Error::Revoked)));
    println!(
        "{}",
        json!({"synthetic":true,"cpu_threads":2,"gpu_layers":0,"results":results,
        "basic_stream_matches_final":true,"basic_answer":basic,
        "cancelled":true,"cancel_elapsed_ms":cancel_elapsed_ms,
        "lock_revoked":true,"lock_elapsed_ms":started.elapsed().as_millis(),
        "language_mismatch_rejected":true,"runtime":loklm_inference::CHECKED_GENERATION_VERSION,
        "model_sha256":loklm_inference::QWEN4B_LOCAL_SHA,
        "validation":"typed envelope and source identity/provenance; no full semantic QA guarantee"})
    );
    Ok(())
}
