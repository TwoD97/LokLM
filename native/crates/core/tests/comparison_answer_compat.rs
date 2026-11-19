use loklm_core::{
    comparison_answer::{ComparisonPassage, ComparisonPlan, Rejection, VERSION},
    ordered_json,
    qa::Language,
};
use serde_json::{Value, json};
#[test]
fn original_comparison_catalog_schema_parsing_and_rendering_match() {
    let fixture: Value =
        serde_json::from_str(include_str!("fixtures/original-comparison-answer.json")).unwrap();
    let mut plans = Vec::new();
    for (i, case) in fixture["plans"].as_array().unwrap().iter().enumerate() {
        let input = serde_json::from_value::<Vec<ComparisonPassage>>(case["input"].clone());
        let plan = input
            .as_ref()
            .ok()
            .and_then(|input| ComparisonPlan::new(case["question"].as_str().unwrap(), input));
        assert_eq!(
            plan.is_some(),
            case["admitted"] == true,
            "plan admission {i}"
        );
        if let Some(plan) = &plan {
            let metadata = json!({ "version": VERSION, "comparisonMode": plan.comparison_mode(), "conciseUnitCount": plan.concise_unit_count(), "summaryMaxCodePoints": plan.summary_max_code_points(), "schema": serde_json::to_string(plan.json_schema()).unwrap() });
            assert_eq!(metadata, case["expected"], "metadata {i}");
            let mut input = input.unwrap();
            for source in &input {
                assert_eq!(
                    plan.prompt_source_text(source.document_id, source.chunk_id),
                    Some(source.text.as_str())
                );
            }
            let id = (input[0].document_id, input[0].chunk_id);
            let original = input[0].text.clone();
            input[0].text = "caller mutation".to_owned();
            assert_eq!(plan.prompt_source_text(id.0, id.1), Some(original.as_str()));
            assert!(plan.prompt_source_text(0, 0).is_none());
        }
        plans.push(plan);
    }
    for (i, case) in fixture["cases"].as_array().unwrap().iter().enumerate() {
        if case["faultInjected"] == true {
            assert!(case["expected"].is_null());
            continue;
        } // Private summary fault-injection coverage.
        let plan = plans[case["plan"].as_u64().unwrap() as usize]
            .as_ref()
            .unwrap();
        let raw = case["raw"].as_str();
        if case["unicodeTransport"] == false {
            assert_eq!(
                ordered_json::parse(raw.unwrap()),
                Err(ordered_json::DecodeRejection::Json)
            );
            assert!(case["expected"].is_null());
            continue;
        }
        let language = if case["language"] == "de" {
            Language::De
        } else {
            Language::En
        };
        let result = raw.ok_or_else(|| Rejection::Bounds.into()).and_then(|raw| {
            plan.parse(
                raw,
                language,
                case["max"]
                    .as_u64()
                    .and_then(|n| usize::try_from(n).ok())
                    .unwrap_or(0),
            )
        });
        let (actual, reason, ordinary, comparison) = match result {
            Ok(result) => (json!(result), Value::Null, Value::Null, Value::Null),
            Err(error) => (
                Value::Null,
                json!(error.reason),
                json!(error.ordinary),
                json!(error.comparison),
            ),
        };
        assert_eq!(actual, case["expected"], "parsed case {i}");
        assert_eq!(reason, case["reason"], "reason case {i}");
        assert_eq!(ordinary, case["ordinary"], "ordinary detail case {i}");
        assert_eq!(comparison, case["comparison"], "comparison detail case {i}");
    }
}
