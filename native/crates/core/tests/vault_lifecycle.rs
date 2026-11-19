#![cfg(feature = "storage")]
use loklm_core::vault::{Vault, backup_path};
use serde_json::json;

#[test]
fn backup_write_failure_preserves_authoritative_primary() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("loklm.vault");
    let phrase = Vault::new_recovery_phrase();
    let mut vault =
        Vault::create("Synthetic", b"Synthetic-fixture-47!", phrase.as_bytes()).unwrap();
    vault.persist(&path).unwrap();
    let original = std::fs::read(&path).unwrap();
    // All paths belong to this test's newly-created temporary directory.
    std::fs::rename(backup_path(&path), root.path().join("saved-backup")).unwrap();
    std::fs::create_dir(backup_path(&path)).unwrap();
    vault.body["kv"]["next-generation"] = json!("must not replace primary on backup failure");
    assert!(vault.persist(&path).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), original);
    assert_eq!(
        std::fs::read(root.path().join("saved-backup")).unwrap(),
        original
    );
}

#[test]
fn recovery_rotates_credentials_preserves_records_and_rekeys_backup() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("loklm.vault");
    let recovery = Vault::new_recovery_phrase();
    assert_eq!(recovery.split_whitespace().count(), 18);
    let mut v = Vault::create("Synthetic", b"Synthetic-pass-47!", recovery.as_bytes()).unwrap();
    v.add_workspace("Deutsch / English").unwrap();
    v.body["kv"]["future-field"] = json!("keep me");
    v.persist(&path).unwrap();
    let before = v.body.clone();
    drop(v);
    let (reset, new_phrase) =
        Vault::reset_copy(&path, recovery.as_bytes(), b"Replacement-pass-48!").unwrap();
    assert_eq!(reset.body, before);
    reset.persist(&path).unwrap();
    drop(reset);
    assert!(Vault::open(&path, b"Synthetic-pass-47!").is_err());
    assert!(
        Vault::decode(
            &std::fs::read(backup_path(&path)).unwrap(),
            b"Synthetic-pass-47!",
            false
        )
        .is_err()
    );
    assert_eq!(
        Vault::open(&path, b"Replacement-pass-48!").unwrap().body,
        before
    );
    let bytes = std::fs::read(&path).unwrap();
    assert!(Vault::decode(&bytes, recovery.as_bytes(), true).is_err());
    assert_eq!(
        Vault::decode(&bytes, new_phrase.as_bytes(), true)
            .unwrap()
            .body,
        before
    );
}
#[test]
fn legacy_corruption_and_traversal_fail_closed() {
    let mut bytes = include_bytes!("fixtures/original-v6.vault").to_vec();
    bytes[6] = b'5';
    assert!(Vault::decode(&bytes, b"Synthetic-fixture-47!", false).is_err());
    for len in [0, 7, 11, 39] {
        assert!(Vault::decode(&bytes[..len], b"test", false).is_err());
    }
    let mut vault = Vault::decode(
        include_bytes!("fixtures/original-v6.vault"),
        b"Synthetic-fixture-47!",
        false,
    )
    .unwrap();
    vault.body["manifest"]["workspaces"][0]["dir"] = json!("../other");
    assert!(vault.workspace_key(1).is_err());
    assert!(vault.workspace_key(999).is_err());
}
#[test]
fn backup_fallback_never_overwrites_damaged_primary() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("loklm.vault");
    std::fs::write(&path, b"damaged primary").unwrap();
    std::fs::write(
        backup_path(&path),
        include_bytes!("fixtures/original-v6.vault"),
    )
    .unwrap();
    let vault = Vault::open(&path, b"Synthetic-fixture-47!").unwrap();
    assert!(vault.loaded_from_backup);
    assert!(vault.persist(&path).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), b"damaged primary");
}
