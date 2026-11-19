//! Explicit CPU-only smoke test. Args: embedding|generation path/to/model.gguf
//! Never discovers personal vaults or contacts an existing model server.
use loklm_core::{qa, session::Sessions};
use loklm_inference::{Model, ModelKind};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.len() != 2 {
        return Err("Expected embedding|generation and an explicit GGUF path".into());
    }
    let sessions = Sessions::default();
    sessions.publish(sessions.epoch())?;
    let ticket = sessions.ticket()?;
    if args[0] == "template" {
        loklm_inference::verify_qwen_template(std::path::Path::new(&args[1]), &ticket)?;
        println!(
            "{{\"template\":\"Qwen4B canonical ChatML\",\"untrusted_role_tokens_isolated\":true,\"tensor_weights_loaded\":false}}"
        );
        return Ok(());
    }
    let kind = match args[0].as_str() {
        "embedding" => ModelKind::BgeM3,
        "rerank" => ModelKind::BgeReranker,
        "generation" => ModelKind::Qwen4B,
        _ => return Err("Unknown mode".into()),
    };
    let model = Model::load(std::path::Path::new(&args[1]), kind, &ticket)?;
    if args[0] == "rerank" {
        let documents = vec![
            "Berlin is the capital of Germany.".to_string(),
            "Bananas grow in tropical regions.".to_string(),
            "Berlin ist die Hauptstadt von Deutschland.".to_string(),
        ];
        let scores = model.rerank("What is the capital of Germany?", &documents, &ticket)?;
        if scores[0] <= scores[1] || scores[2] <= scores[1] {
            return Err("Reranker did not separate synthetic relevant passages".into());
        }
        println!(
            "{}",
            serde_json::json!({"scores":scores,"documents":documents,"model_sha256":kind.sha(),"runtime":loklm_inference::RUNTIME_ID})
        );
    } else if args[0] == "embedding" {
        let a = model.embed(
            "Berlin ist die Hauptstadt von Deutschland.",
            false,
            false,
            &ticket,
        )?;
        let b = model.embed("What is the capital of Germany?", true, false, &ticket)?;
        println!(
            "{}",
            serde_json::json!({"dimension":a.len(),"norm":a.iter().map(|f|f*f).sum::<f32>().sqrt(),"query_cosine":a.iter().zip(&b).map(|(a,b)|a*b).sum::<f32>(),"fingerprint":model.embedding_fingerprint(false)?})
        );
    } else {
        let hit=qa::Passage{document_id:7,chunk_id:11,document_title:"Synthetic library".into(),text:"The synthetic library access code is ALPHA-47. Der synthetische Bibliothekscode lautet ALPHA-47.".into(),heading_path:Some(vec!["Access".into()]),page_from:None,page_to:None,language:None,origin:None};
        let question = "What is the library access code? Answer in one sentence.";
        let system = qa::system_prompt(qa::Language::En, qa::Depth::Concise, false);
        let prompt = qa::build_prompt(
            question,
            std::slice::from_ref(&hit),
            &[],
            qa::Language::En,
            &[],
            None,
        );
        let mut chunks = 0;
        let answer = model.generate(system, &prompt, 256, &ticket, |_| {
            chunks += 1;
            Ok(())
        })?;
        let citations = qa::validate_citations(&answer, std::slice::from_ref(&hit))?;
        if !answer.contains("ALPHA-47") {
            return Err("Synthetic code missing from model answer".into());
        }
        println!(
            "{}",
            serde_json::json!({"question":question,"supplied":[hit],"answer":answer,"citations":citations,"stream_chunks":chunks,"runtime":loklm_inference::RUNTIME_ID,"model_sha256":kind.sha(),"synthetic":true})
        );
    }
    Ok(())
}
