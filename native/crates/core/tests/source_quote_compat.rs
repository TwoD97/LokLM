use loklm_core::source_quote::{self, AnchoredQuote, QuoteResolution, QuoteResolver, QuoteSource};
use serde_json::Value;
#[test]
fn actual_original_quote_and_catalog_outputs_match() {
    let fixture: Value =
        serde_json::from_str(include_str!("fixtures/original-source-quotes.json")).unwrap();
    for case in fixture["anchors"].as_array().unwrap() {
        let source = case["source"].as_str().unwrap();
        let proposed = case["proposed"].as_str().unwrap();
        let actual = source_quote::anchor(source, proposed);
        assert_eq!(
            serde_json::to_value(&actual).unwrap(),
            case["anchor"],
            "quote={proposed:?}"
        );
        if let Some(anchor) = &actual {
            assert_eq!(
                &source[source_quote::byte_range(source, anchor).unwrap()],
                anchor.quote
            );
        }
        let expanded = actual
            .as_ref()
            .and_then(|a| source_quote::expand_context(source, a));
        assert_eq!(
            serde_json::to_value(expanded).unwrap(),
            case["expanded"],
            "expanded quote={proposed:?}"
        );
    }
    for case in fixture["resolvers"].as_array().unwrap() {
        let input: Vec<QuoteSource> = serde_json::from_value(case["input"].clone()).unwrap();
        let mut resolver = QuoteResolver::new(&input);
        assert_eq!(resolver.is_some(), case["valid"].as_bool().unwrap());
        for query in case["results"].as_array().unwrap() {
            let actual = resolver
                .as_mut()
                .unwrap()
                .resolve(query["proposed"].as_str().unwrap());
            assert_eq!(serde_json::to_value(actual).unwrap(), query["result"]);
        }
    }
}
#[test]
fn byte_offsets_and_cached_results_cannot_be_forged_by_mutation() {
    let source = "🚀 Grüße Berlin";
    let anchor = source_quote::anchor(source, "Grüße").unwrap();
    assert_eq!(anchor.start, 3);
    assert_eq!(source_quote::byte_range(source, &anchor), Some(5..12));
    let forged = AnchoredQuote {
        quote: "🚀".into(),
        start: 1,
        end: 2,
        ambiguous: false,
    };
    assert!(source_quote::byte_range(source, &forged).is_none());
    assert!(source_quote::expand_context(source, &forged).is_none());
    let mut resolver = QuoteResolver::new(&[QuoteSource {
        document_id: 1,
        chunk_id: 2,
        text: source.into(),
    }])
    .unwrap();
    let expected = resolver.resolve("Grüße");
    let mut edited = expected.clone();
    if let QuoteResolution::Resolved { span } = &mut edited {
        span.text = "Invented".into();
    }
    assert_ne!(expected, edited);
    assert_eq!(resolver.resolve("Grüße"), expected);
}
