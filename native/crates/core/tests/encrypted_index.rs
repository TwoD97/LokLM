#![cfg(feature = "storage")]
use loklm_core::{models::EMBEDDING_DIM, session::Sessions, store::Store};
#[test]
fn index_is_scoped_versioned_encrypted_and_resumable() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("meta.db");
    let sessions = Sessions::default();
    sessions.publish(sessions.epoch()).unwrap();
    let t = sessions.ticket().unwrap();
    let mut store = Store::open(&path, &[34; 32], true).unwrap();
    store
        .import_text(
            "synthetic://de.md",
            "Berlin",
            "# Reisen\nBerlin ist die Hauptstadt.",
            &t,
        )
        .unwrap();
    store
        .import_text("synthetic://en.md", "London", "London is in England.", &t)
        .unwrap();
    store.initialize_native_index(&t).unwrap();
    let fingerprint = "a".repeat(64);
    let other = "b".repeat(64);
    let pending = store.pending_vectors(&fingerprint, 8, &t).unwrap();
    assert_eq!(pending.len(), 2);
    assert_eq!(pending[0].heading_path.as_ref().unwrap(), &["Reisen"]);
    let mut vector = vec![0f32; EMBEDDING_DIM];
    vector[0] = 1.;
    store
        .put_vector(pending[0].chunk_id, &fingerprint, &vector, &t)
        .unwrap();
    let mut second = vec![0f32; EMBEDDING_DIM];
    second[1] = 1.;
    let cancel = sessions.ticket().unwrap();
    cancel.cancel();
    assert!(
        store
            .put_vector(pending[1].chunk_id, &fingerprint, &second, &cancel)
            .is_err()
    );
    drop(store);
    let mut store = Store::open(&path, &[34; 32], false).unwrap();
    assert_eq!(store.pending_vectors(&fingerprint, 8, &t).unwrap().len(), 1);
    store
        .put_vector(pending[1].chunk_id, &fingerprint, &second, &t)
        .unwrap();
    assert!(
        store
            .pending_vectors(&fingerprint, 8, &t)
            .unwrap()
            .is_empty()
    );
    assert_eq!(store.pending_vectors(&other, 8, &t).unwrap().len(), 2);
    assert!(store.dense(&vector, &other, 8, &t).unwrap().is_empty());
    let ranked = store.dense(&vector, &fingerprint, 8, &t).unwrap();
    assert_eq!(ranked[0].chunk_id, pending[0].chunk_id);
    assert!((ranked[0].score - 1.).abs() < 1e-6);
    let other_path = root.path().join("other.db");
    let other_store = Store::open(&other_path, &[35; 32], true).unwrap();
    other_store.initialize_native_index(&t).unwrap();
    assert!(
        other_store
            .dense(&vector, &fingerprint, 8, &t)
            .unwrap()
            .is_empty()
    );
    let bytes = std::fs::read(&path).unwrap();
    assert!(!bytes.windows(6).any(|b| b == b"Berlin"));
    assert!(!bytes.windows(64).any(|b| b == fingerprint.as_bytes()));
    sessions.revoke();
    assert!(store.dense(&vector, &fingerprint, 8, &t).is_err());
}
