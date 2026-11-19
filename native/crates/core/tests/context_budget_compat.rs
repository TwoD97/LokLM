use loklm_core::context_budget::{self, ContextInput, ContextRejection};
use serde_json::{Value, json};
#[test]
fn original_context_allocation_retains_metadata_and_final_checked_bundle() {
    let fixture: Value =
        serde_json::from_str(include_str!("fixtures/original-context-budget.json")).unwrap();
    for (i, case) in fixture["cases"].as_array().unwrap().iter().enumerate() {
        let mut input: ContextInput = serde_json::from_value(case["input"].clone()).unwrap();
        let plan = context_budget::plan(&input);
        if case["rejected"] == true {
            assert!(
                matches!(plan, Err(ContextRejection::StandaloneRequired)),
                "rejection {i}"
            );
            continue;
        }
        let plan = plan.unwrap();
        let mut result = serde_json::to_value(&plan).unwrap();
        result["checked"] = plan.checked_bundle().map_or(Value::Null, |b| json!({ "prompt": b.prompt(), "systemPrompt": b.system_prompt(), "admitted": b.comparison_plan().is_some(), "mode": b.comparison_plan().map(|p| p.comparison_mode()), "schema": b.comparison_plan().map(|p| serde_json::to_string(p.json_schema()).unwrap()) }));
        assert_eq!(result, case["expected"], "context case {i}");
        let before = serde_json::to_value(&plan).unwrap();
        input.hits.clear();
        input.pinned_groups.clear();
        input.question = "caller mutation".to_owned();
        assert_eq!(serde_json::to_value(&plan).unwrap(), before);
        if let Some(bundle) = plan.checked_bundle() {
            assert_eq!(json!(bundle.prompt()), result["checked"]["prompt"]);
            if let Some(catalog) = bundle.comparison_plan() {
                for hit in plan.pinned_hits().iter().chain(plan.hits()) {
                    let p = hit.passage();
                    assert_eq!(
                        catalog.prompt_source_text(p.document_id, p.chunk_id),
                        Some(p.text.as_str())
                    );
                }
            }
        }
    }
}

#[test]
fn unrepresentable_provider_window_does_not_saturate_to_a_valid_plan() {
    let input: ContextInput = serde_json::from_value(json!({"contextTokens":f64::MAX,"question":"Synthetic window boundary","language":"en","hits":[]})).unwrap();
    assert!(matches!(
        context_budget::plan(&input),
        Err(ContextRejection::InvalidWindow)
    ));
}
