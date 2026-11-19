use loklm_core::source_quantities::{QuantityPassage, QuantityResult, annotate};
use serde::Deserialize;
#[derive(Deserialize)]
struct Fixture {
    input: Vec<QuantityPassage>,
    expected: QuantityResult,
}
#[test]
fn original_arithmetic_catalogs_and_utf16_spans_match() {
    let fixtures: Vec<Fixture> =
        serde_json::from_str(include_str!("fixtures/original-source-quantities.json")).unwrap();
    for (index, fixture) in fixtures.into_iter().enumerate() {
        let before = serde_json::to_value(&fixture.input).unwrap();
        let result = annotate(&fixture.input);
        assert_eq!(result, fixture.expected, "original case {index}");
        assert_eq!(serde_json::to_value(&fixture.input).unwrap(), before);
        for q in result.quantities {
            let source = fixture
                .input
                .iter()
                .find(|p| p.document_id == q.document_id && p.chunk_id == q.chunk_id)
                .unwrap();
            let units: Vec<u16> = source.text.encode_utf16().collect();
            assert_eq!(String::from_utf16(&units[q.start..q.end]).unwrap(), q.text);
        }
    }
}
