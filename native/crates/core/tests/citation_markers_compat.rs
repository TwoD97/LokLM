use loklm_core::citation_markers::*;
use serde_json::{Value, json};
use std::collections::HashSet;
fn set(value: &Value) -> HashSet<String> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .map(|v| v.as_str().unwrap().to_owned())
        .collect()
}
#[test]
fn original_markers_literal_mask_and_label_cleanup_match() {
    let fixture: Value =
        serde_json::from_str(include_str!("fixtures/original-citation-markers.json")).unwrap();
    for (i, case) in fixture["cases"].as_array().unwrap().iter().enumerate() {
        let args = &case["args"];
        let text = args[0].as_str().unwrap_or("");
        let name = case["name"].as_str().unwrap();
        let mut rejection = Value::Null;
        let result = match name {
            "findCitationMatches" => json!(find_citation_matches(text)),
            "findCitationAttempts" => json!(find_citation_attempts(text)),
            "extractCitationMarkers" => json!(extract_citation_markers(text)),
            "hasUnmaskedCitationSyntax" => json!(has_unmasked_citation_syntax(text)),
            "hasActiveHtmlSyntax" => json!(has_active_html_syntax(text)),
            "stripCitationMarkers" => json!(strip_citation_markers(text)),
            "hasCitedSources" => json!(has_cited_sources(text, &set(&args[1]))),
            "transformCitationMarkers" => json!(transform_citation_markers(text, &set(&args[1]))),
            "parseCiteHref" => json!(parse_cite_href(args[0].as_str())),
            "reconcileCitations" => {
                let fed = args[1].as_array().unwrap();
                let keyed: Vec<_> = fed
                    .iter()
                    .cloned()
                    .zip(
                        args[2]
                            .as_array()
                            .unwrap()
                            .iter()
                            .map(|s| s.as_str().unwrap().to_owned()),
                    )
                    .collect();
                json!(
                    reconcile_citations(text, &keyed, |(_, key)| key.clone())
                        .into_iter()
                        .map(|(v, _)| v)
                        .collect::<Vec<_>>()
                )
            }
            "removeRedundantSourceLabels" => {
                match remove_redundant_source_labels(text, &set(&args[1])) {
                    Ok(s) => json!(s),
                    Err(r) => {
                        rejection = json!(r);
                        Value::Null
                    }
                }
            }
            "renderSourceLinkedAnswer" => match loklm_core::source_linked_answer::render(
                &args[0],
                &set(&args[1]),
                args[2]
                    .as_u64()
                    .and_then(|n| usize::try_from(n).ok())
                    .unwrap_or(0),
            ) {
                Ok(s) => json!(s),
                Err(r) => {
                    rejection = json!(r);
                    Value::Null
                }
            },
            _ => panic!("unknown API {name}"),
        };
        assert_eq!(result, case["expected"], "case {i} {name}, input {text:?}");
        assert_eq!(rejection, case["rejection"], "case {i} {name} rejection");
        if name == "findCitationMatches" {
            let units: Vec<_> = text.encode_utf16().collect();
            for marker in find_citation_matches(text) {
                let slice = String::from_utf16(&units[marker.start..marker.end]).unwrap();
                assert!(slice.starts_with("[doc:"));
                assert!(slice.ends_with(']'));
            }
        }
    }
}
