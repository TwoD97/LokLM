use loklm_core::{checked_answer, comparison_answer::ComparisonMode, qa::Language};
use serde_json::{Value, json};
#[test]
fn original_checked_contexts_preserve_contracts_sources_and_arithmetic() {
    let fixture: Value =
        serde_json::from_str(include_str!("fixtures/original-checked-prompts.json")).unwrap();
    for (i, case) in fixture["cases"].as_array().unwrap().iter().enumerate() {
        let language = if case["language"] == "de" {
            Language::De
        } else {
            Language::En
        };
        let mode = if case["mode"] == "summary" {
            ComparisonMode::Summary
        } else {
            ComparisonMode::Full
        };
        let actual = match case["kind"].as_str().unwrap() {
            "system" => json!(checked_answer::system_prompt(language, mode)),
            "limit" => json!(checked_answer::answer_char_limit(
                case["maxTokens"].as_f64().unwrap_or(f64::NAN)
            )),
            "prompt" | "bundle" | "general" => {
                let hits: Vec<_> = serde_json::from_value(case["hits"].clone()).unwrap();
                let pinned: Vec<_> = serde_json::from_value(case["pinned"].clone()).unwrap();
                let question = case["question"].as_str().unwrap();
                if case["kind"] == "general" {
                    use loklm_core::qa::{self, CitationOutput};
                    let output = match case["output"].as_str().unwrap() {
                        "structured-sources" => CitationOutput::StructuredSources,
                        "structured-summary" => CitationOutput::StructuredSummary,
                        _ => CitationOutput::Markers,
                    };
                    json!(qa::build_prompt_with_output(
                        question,
                        &hits,
                        &[],
                        language,
                        &pinned,
                        None,
                        output
                    ))
                } else if case["kind"] == "prompt" {
                    json!(checked_answer::build_prompt(
                        question, &hits, language, &pinned, mode
                    ))
                } else {
                    let bundle =
                        checked_answer::ContextBundle::new(question, &hits, language, &pinned);
                    json!({"prompt":bundle.prompt(),"systemPrompt":bundle.system_prompt(),"admitted":bundle.comparison_plan().is_some(),"mode":bundle.comparison_plan().map(|p| p.comparison_mode())})
                }
            }
            _ => panic!("unknown fixture"),
        };
        assert_eq!(actual, case["expected"], "checked context case {i}");
    }
}
