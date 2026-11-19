#![cfg(feature = "storage")]
use loklm_core::{chunking::chunk_pages, session::Sessions, store::Store};
#[test]
fn parsed_pages_preserve_citations_and_reject_partial_or_changed_revisions() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("meta.db");
    let sessions = Sessions::default();
    sessions.publish(sessions.epoch()).unwrap();
    let ticket = sessions.ticket().unwrap();
    let mut store = Store::open(&path, &[91; 32], true).unwrap();
    let chunks = chunk_pages(&[
        (1, "Grüße aus Berlin".into()),
        (2, "Library code ALPHA-47".into()),
    ]);
    let hash = "a".repeat(64);
    let id = store
        .import_chunks(
            "synthetic://two-pages.pdf",
            "DE/EN",
            "application/pdf",
            512,
            &hash,
            &chunks,
            &ticket,
        )
        .unwrap();
    assert_eq!(
        store
            .import_chunks(
                "synthetic://two-pages.pdf",
                "DE/EN",
                "application/pdf",
                512,
                &hash,
                &chunks,
                &ticket
            )
            .unwrap(),
        id
    );
    assert!(
        store
            .import_chunks(
                "synthetic://two-pages.pdf",
                "Changed",
                "application/pdf",
                513,
                &"b".repeat(64),
                &chunks,
                &ticket
            )
            .is_err()
    );
    assert!(
        store
            .import_chunks(
                "synthetic://empty.pdf",
                "Empty",
                "application/pdf",
                512,
                &hash,
                &[],
                &ticket
            )
            .is_err()
    );
    let cancelled = sessions.ticket().unwrap();
    cancelled.cancel();
    assert!(
        store
            .import_chunks(
                "synthetic://cancelled.pdf",
                "Cancelled",
                "application/pdf",
                512,
                &hash,
                &chunks,
                &cancelled
            )
            .is_err()
    );
    drop(store);
    let store = Store::open(&path, &[91; 32], false).unwrap();
    assert_eq!(store.list(&ticket).unwrap().len(), 1);
    let hit = store.search("ALPHA", 8, &ticket).unwrap().remove(0);
    assert_eq!(hit.document_id, id);
    assert_eq!(hit.page_from, Some(2));
    assert_eq!(hit.page_to, Some(2));
    assert_eq!(
        store.source(hit.chunk_id, &ticket).unwrap().text,
        "Library code ALPHA-47"
    );
}
