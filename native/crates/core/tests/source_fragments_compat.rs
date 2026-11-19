use loklm_core::source_fragments::{FragmentMatcher, FragmentRejection, is_display_fragment};
use serde_json::{Value, json};
fn text(value: &Value) -> Option<String> {
    let units = value["units"]
        .as_array()?
        .iter()
        .map(|n| n.as_u64().and_then(|n| u16::try_from(n).ok()))
        .collect::<Option<Vec<_>>>()?;
    String::from_utf16(&units).ok()
}
#[test]
fn original_exact_fragments_excerpts_and_rejection_categories_match() {
    let fixture: Value =
        serde_json::from_str(include_str!("fixtures/original-source-fragments.json")).unwrap();
    for (i, case) in fixture["cases"].as_array().unwrap().iter().enumerate() {
        let value = text(&case["value"]);
        let max = case["max"].as_u64().unwrap() as usize;
        if case["kind"] == "display" {
            assert_eq!(
                json!(value.as_ref().is_some_and(|s| is_display_fragment(
                    s,
                    max,
                    case["title"] == true
                ))),
                case["expected"],
                "display {i}"
            );
            continue;
        }
        let result = match (text(&case["source"]), value) {
            (Some(source), Some(value)) => {
                let matcher = FragmentMatcher::new(source.clone());
                let result = if case["kind"] == "fragment" {
                    matcher
                        .match_fragment(&value, max)
                        .map(|r| serde_json::to_value(r).unwrap())
                } else {
                    matcher
                        .match_excerpt(&value, max)
                        .map(|r| serde_json::to_value(r).unwrap())
                };
                if let Ok(ref value) = result {
                    let units: Vec<u16> = source.encode_utf16().collect();
                    let spans = if case["kind"] == "fragment" {
                        vec![value]
                    } else {
                        vec![&value["selected"], &value["display"]]
                    };
                    for span in spans {
                        assert_eq!(
                            String::from_utf16(
                                &units[span["start"].as_u64().unwrap() as usize
                                    ..span["end"].as_u64().unwrap() as usize]
                            )
                            .unwrap(),
                            span["text"].as_str().unwrap()
                        );
                    }
                }
                result
            }
            // Rust/JSON IPC strings cannot represent an unpaired surrogate.
            _ => Err(FragmentRejection::Display),
        };
        let (actual, rejection) = match result {
            Ok(v) => (v, Value::Null),
            Err(reason) => (Value::Null, serde_json::to_value(reason).unwrap()),
        };
        assert_eq!(actual, case["expected"], "fragment case {i}");
        assert_eq!(rejection, case["rejection"], "rejection case {i}");
    }
}
