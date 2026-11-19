use anyhow::Result;
use loklm_knowledge::{
    index::Index,
    models::{ModelClient, Profile},
};

#[test]
fn provider_and_checkpoint_json_preserve_float_boundaries() -> Result<()> {
    let edge: f64 = serde_json::from_str("0.9999999999999999")?;
    assert_eq!(edge.to_bits(), 0x3fefffffffffffff);
    // Just above a binary32 midpoint. Parsing through binary64 first can round
    // to the midpoint and then to the wrong even f32 neighbor (double rounding).
    let edge: f32 = serde_json::from_str("1.0000000596046448")?;
    assert_eq!(edge.to_bits(), 0x3f800001);
    let values = [edge, f32::MIN_POSITIVE, f32::from_bits(1), -0.0, -edge];
    let restored: Vec<f32> = serde_json::from_str(&serde_json::to_string(&values)?)?;
    assert!(
        values
            .iter()
            .zip(restored)
            .all(|(a, b)| a.to_bits() == b.to_bits())
    );
    Ok(())
}

#[tokio::test]
async fn old_numeric_transport_index_is_rejected_without_overwrite() -> Result<()> {
    let folder = tempfile::tempdir()?;
    let runtime = "synthetic-provider-v1";
    let legacy_fingerprint =
        loklm_knowledge::digest(format!("{}:{runtime}", Profile::Standard.fingerprint()));
    let mut old = ModelClient::new("http://127.0.0.1:1/", Profile::Standard, runtime)?;
    old.fingerprint = legacy_fingerprint.clone();
    drop(Index::open(folder.path(), Some(old)).await?);
    let current = ModelClient::new("http://127.0.0.1:1/", Profile::Standard, runtime)?;
    assert_ne!(current.fingerprint, legacy_fingerprint);
    let result = Index::open(folder.path(), Some(current)).await;
    assert!(
        result
            .err()
            .unwrap()
            .to_string()
            .contains("NEW index directory")
    );
    let db = rusqlite::Connection::open(folder.path().join("checkpoint.sqlite"))?;
    let retained: String =
        db.query_row("SELECT value FROM meta WHERE key='fingerprint'", [], |r| {
            r.get(0)
        })?;
    assert_eq!(retained, legacy_fingerprint);
    Ok(())
}
