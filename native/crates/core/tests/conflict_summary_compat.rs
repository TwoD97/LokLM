use loklm_core::{answer_format, conflict_summary, ordered_json, qa::Language};
use serde_json::{Value, json};
#[test]
fn original_conflict_reporting_format_and_escaping_match() {
    let fixture: Value =
        serde_json::from_str(include_str!("fixtures/original-conflict-summary.json")).unwrap();
    for (i, case) in fixture["cases"].as_array().unwrap().iter().enumerate() {
        let mut rejection = Value::Null;
        let result = match case["kind"].as_str().unwrap() {
            "schema" => {
                let ids = case["ids"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v.as_str().unwrap().to_owned())
                    .collect::<Vec<_>>();
                json!(serde_json::to_string(&conflict_summary::schema(&ids).unwrap()).unwrap())
            }
            "format" => json!(answer_format::requests_single_sentence(
                case["question"].as_str().unwrap()
            )),
            "escapeSourceMarkdown" => json!(answer_format::escape_source_markdown(
                case["text"].as_str().unwrap()
            )),
            "sourceQuoteMarkdown" => json!(answer_format::source_quote_markdown(
                case["text"].as_str().unwrap()
            )),
            "summary" => {
                if case["faultInjected"] == true {
                    continue;
                } // Exercised by the module's private fault-injection test.
                if case["unicodeTransport"] == false {
                    // An unpaired JS surrogate cannot cross the Rust JSON/String
                    // boundary. Rejection is earlier than fragment validation.
                    assert_eq!(
                        ordered_json::parse(case["raw"].as_str().unwrap()),
                        Err(ordered_json::DecodeRejection::Json)
                    );
                    assert!(case["expected"].is_null());
                    continue;
                }
                let value = ordered_json::parse(case["raw"].as_str().unwrap())
                    .unwrap_or_else(|e| panic!("decode case {i}: {e:?}"));
                let sources = case["sources"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|v| {
                        (
                            v[0].as_str().unwrap().to_owned(),
                            v[1].as_str().unwrap().to_owned(),
                        )
                    })
                    .collect();
                let language = if case["language"] == "de" {
                    Language::De
                } else {
                    Language::En
                };
                match conflict_summary::render(
                    &value,
                    &sources,
                    language,
                    case["max"].as_u64().unwrap() as usize,
                ) {
                    Ok(result) => {
                        for span in result.spans.iter().chain(&result.display_spans) {
                            let units: Vec<_> = sources[&span.source].encode_utf16().collect();
                            assert_eq!(
                                String::from_utf16(&units[span.fragment.start..span.fragment.end])
                                    .unwrap(),
                                span.fragment.text,
                                "span case {i}"
                            );
                        }
                        json!(result)
                    }
                    Err(reason) => {
                        rejection = json!(reason);
                        Value::Null
                    }
                }
            }
            _ => panic!("unknown fixture kind"),
        };
        assert_eq!(result, case["expected"], "case {i} {}", case["kind"]);
        if case["kind"] == "summary" {
            assert_eq!(rejection, case["rejection"], "rejection case {i}");
        }
    }
}
