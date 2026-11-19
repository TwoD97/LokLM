use loklm_core::source_calculations::{CalculationPassage, CalculationResult, annotate};
use serde::Deserialize;
#[derive(Deserialize)]
struct Fixture {
    question: String,
    passages: Vec<CalculationPassage>,
    expected: CalculationResult,
}
#[test]
fn original_numeric_interpretation_and_source_spans_match() {
    let fixtures: Vec<Fixture> =
        serde_json::from_str(include_str!("fixtures/original-source-calculations.json")).unwrap();
    assert!(!fixtures.is_empty());
    for (index, fixture) in fixtures.into_iter().enumerate() {
        let before = serde_json::to_value(&fixture.passages).unwrap();
        let result = annotate(&fixture.question, &fixture.passages);
        assert_eq!(
            result, fixture.expected,
            "original case {index}: {}",
            fixture.question
        );
        assert_eq!(serde_json::to_value(&fixture.passages).unwrap(), before);
        for calculation in result.calculations {
            let source = fixture
                .passages
                .iter()
                .find(|p| {
                    p.document_id == calculation.document_id && p.chunk_id == calculation.chunk_id
                })
                .unwrap();
            let units: Vec<u16> = source.text.encode_utf16().collect();
            assert_eq!(
                String::from_utf16(&units[calculation.start..calculation.end]).unwrap(),
                calculation.source
            );
        }
    }
}
