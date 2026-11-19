use loklm_core::source_units::{UnitPassage, create};
use serde_json::{Value, json};
#[test]
fn original_complete_units_and_exact_labelled_passages_match() {
    let fixture: Value =
        serde_json::from_str(include_str!("fixtures/original-source-units.json")).unwrap();
    for (i, case) in fixture["cases"].as_array().unwrap().iter().enumerate() {
        let mut input: Vec<UnitPassage> = serde_json::from_value(case["input"].clone()).unwrap();
        let actual = match create(&input) {
            Err(reason) => json!({"ok":false,"reason":reason}),
            Ok(catalog) => {
                let labelled = input
                    .iter()
                    .map(|p| {
                        catalog
                            .prompt_source_text(p.document_id, p.chunk_id)
                            .unwrap()
                            .to_owned()
                    })
                    .collect::<Vec<_>>();
                for unit in catalog.units() {
                    assert_eq!(catalog.get(&unit.id), Some(unit));
                    let p = input
                        .iter()
                        .find(|p| format!("{}:{}", p.document_id, p.chunk_id) == unit.source)
                        .unwrap();
                    let units: Vec<u16> = p.text.encode_utf16().collect();
                    assert_eq!(
                        String::from_utf16(&units[unit.start..unit.end]).unwrap(),
                        unit.text
                    );
                }
                assert!(catalog.get("U999").is_none());
                assert!(catalog.prompt_source_text(999, 999).is_none());
                // The immutable catalog owns its contents, independent of the caller.
                input.iter_mut().for_each(|p| p.text.clear());
                json!({"ok":true,"units":catalog.units(),"labelled":labelled})
            }
        };
        assert_eq!(actual, case["expected"], "original source-unit case {i}");
    }
}
