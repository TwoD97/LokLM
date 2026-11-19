use anyhow::Result;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use loklm_knowledge::{
    files::Vault,
    index::Index,
    service::{App, router},
};
use tokio_util::sync::CancellationToken;
use tower::ServiceExt;

#[tokio::test]
async fn embedding_cache_strict_identity_and_changed_chunk_only() -> Result<()> {
    use axum::{
        Json, Router,
        routing::{get, post},
    };
    use loklm_knowledge::models::{ModelClient, Profile};
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    let calls = Arc::new(AtomicUsize::new(0));
    let counter = calls.clone();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let endpoint = format!("http://{}/", listener.local_addr()?);
    let alias =
        ModelClient::new(&endpoint, Profile::Standard, "synthetic-provider-test-v1")?.fingerprint;
    let api=Router::new().route("/v1/models",get(move||{let alias=alias.clone();async move{Json(serde_json::json!({"data":[{"id":alias}]}))}})).route("/v1/embeddings",post(move |Json(input):Json<serde_json::Value>|{let counter=counter.clone();async move{
        counter.fetch_add(1,Ordering::Relaxed);
        let mut vector=vec![0.0f32;1024];vector[0]=1.0;
        Json(serde_json::json!({"model":input["model"],"data":[{"index":0,"embedding":vector}]}))
    }}));
    let server = tokio::spawn(async move {
        axum::serve(listener, api).await.unwrap();
    });
    let notes = tempfile::tempdir()?;
    let state = tempfile::tempdir()?;
    let vault = Vault::open(notes.path())?;
    vault.import("note.md", "# A\nAlpha original\n# B\nBeta unchanged")?;
    let model = ModelClient::new(&endpoint, Profile::Standard, "synthetic-provider-test-v1")?;
    let index = Index::open(state.path(), Some(model)).await?;
    let cancel = CancellationToken::new();
    let first = index.reconcile(&vault, &cancel).await?;
    assert_eq!(first.embedded, 2);
    let second = index.reconcile(&vault, &cancel).await?;
    assert_eq!(second.embedded, 0);
    assert_eq!(calls.load(Ordering::Relaxed), 2);
    let text = std::fs::read_to_string(notes.path().join("note.md"))?;
    std::fs::write(
        notes.path().join("note.md"),
        text.replace("Alpha original", "Alpha edited"),
    )?;
    let changed = index.reconcile(&vault, &cancel).await?;
    assert_eq!(changed.embedded, 1);
    assert_eq!(changed.reused, 1);
    assert!(!index.search("Beta", &[], 8, &cancel).await?.is_empty());
    drop(index);
    assert!(
        Index::open(
            state.path(),
            Some(ModelClient::new(
                &endpoint,
                Profile::Lite,
                "synthetic-provider-test-v1"
            )?)
        )
        .await
        .is_err()
    );
    let index = Index::open(
        state.path(),
        Some(ModelClient::new(
            &endpoint,
            Profile::Standard,
            "synthetic-provider-test-v1",
        )?),
    )
    .await?;
    index.recover().await?;
    assert!(!index.search("Beta", &[], 8, &cancel).await?.is_empty());
    server.abort();
    Ok(())
}

#[tokio::test]
async fn rename_edit_delete_reopen_and_source_scope() -> Result<()> {
    let notes = tempfile::tempdir()?;
    let state = tempfile::tempdir()?;
    let vault = Vault::open(notes.path())?;
    let id=vault.import("Überblick.md","# Energie\nSolarstrom entsteht aus Sonnenlicht.\n\n# Storage\nBatterien speichern Energie.")?;
    let other = vault.import("Other.md", "# Energy\nSolar power generates electricity.")?;
    let cancel = CancellationToken::new();
    let index = Index::open(state.path(), None).await?;
    assert!(Index::open(state.path(), None).await.is_err());
    let first = index.reconcile(&vault, &cancel).await?;
    assert_eq!(first.sources, 2);
    let found = index
        .search("Solarstrom", std::slice::from_ref(&id), 8, &cancel)
        .await?;
    assert_eq!(found.len(), 2);
    assert_eq!(found[1].origin, "whole_doc");
    assert_eq!(found[0].source_id, id);
    assert_eq!(found[0].heading_path, vec!["Energie"]);
    let anchor = found[0].anchor.clone();
    let chunk_id = found[0].chunk_id;
    assert!(
        index
            .search("Solarstrom", &[other], 8, &cancel)
            .await?
            .is_empty()
    );
    index.reconcile(&vault, &cancel).await?;
    assert_eq!(
        index.search("Solarstrom", &[], 8, &cancel).await?[0].chunk_id,
        chunk_id
    );
    std::fs::rename(
        notes.path().join("Überblick.md"),
        notes.path().join("Renamed.md"),
    )?;
    index.reconcile(&vault, &cancel).await?;
    let hit = &index.search("Solarstrom", &[], 8, &cancel).await?[0];
    assert_eq!(hit.anchor, anchor);
    assert_eq!(hit.path, "Renamed.md");
    assert!(hit.open_uri.contains("Renamed.md"));
    let original = std::fs::read_to_string(notes.path().join("Renamed.md"))?;
    std::fs::write(
        notes.path().join("Renamed.md"),
        original.replace("Solarstrom", "Windkraft"),
    )?;
    index.reconcile(&vault, &cancel).await?;
    assert!(
        index
            .search("Solarstrom", &[], 8, &cancel)
            .await?
            .is_empty()
    );
    assert_eq!(index.search("Windkraft", &[], 8, &cancel).await?.len(), 2);
    drop(index);
    let index = Index::open(state.path(), None).await?;
    assert_eq!(index.search("Windkraft", &[], 8, &cancel).await?.len(), 2);
    std::fs::remove_file(notes.path().join("Renamed.md"))?;
    index.reconcile(&vault, &cancel).await?;
    assert!(index.search("Windkraft", &[], 8, &cancel).await?.is_empty());
    Ok(())
}

#[tokio::test]
async fn malformed_scan_never_deletes_checkpoint_and_cancel_is_respected() -> Result<()> {
    let notes = tempfile::tempdir()?;
    let state = tempfile::tempdir()?;
    let vault = Vault::open(notes.path())?;
    vault.import("good.md", "# Safe\nSynthetic knowledge")?;
    let index = Index::open(state.path(), None).await?;
    let cancel = CancellationToken::new();
    index.reconcile(&vault, &cancel).await?;
    std::fs::remove_file(notes.path().join("good.md"))?;
    std::fs::write(notes.path().join("bad.md"), "---\nloklm_id: bad\n---\n")?;
    assert!(index.reconcile(&vault, &cancel).await.is_err());
    assert_eq!(index.status()?.sources, 1);
    cancel.cancel();
    assert!(index.search("knowledge", &[], 8, &cancel).await.is_err());
    Ok(())
}

#[tokio::test]
async fn auth_bounds_lock_and_instance_isolation() -> Result<()> {
    let notes = tempfile::tempdir()?;
    let state = tempfile::tempdir()?;
    let vault = Vault::open(notes.path())?;
    let app = App::new(
        Index::open(state.path(), None).await?,
        vault,
        "a".repeat(32),
    );
    let api = router(app);
    let req = |uri: &str, token: &str| {
        Request::builder()
            .uri(uri)
            .header("authorization", format!("Bearer {token}"))
            .body(Body::empty())
            .unwrap()
    };
    assert_eq!(
        api.clone().oneshot(req("/healthz", "")).await?.status(),
        StatusCode::OK
    );
    assert_eq!(
        api.clone().oneshot(req("/v1/status", "")).await?.status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        api.clone()
            .oneshot(req("/v1/status", &"b".repeat(32)))
            .await?
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        api.clone()
            .oneshot(req("/v1/status", &"a".repeat(32)))
            .await?
            .status(),
        StatusCode::OK
    );
    let lock = Request::builder()
        .method("POST")
        .uri("/v1/lock")
        .header("authorization", format!("Bearer {}", "a".repeat(32)))
        .body(Body::empty())?;
    assert_eq!(
        api.clone().oneshot(lock).await?.status(),
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        api.oneshot(req("/v1/status", &"a".repeat(32)))
            .await?
            .status(),
        StatusCode::LOCKED
    );
    Ok(())
}

#[tokio::test]
async fn readiness_requires_current_process_success_and_recovers_after_bad_files() -> Result<()> {
    let notes = tempfile::tempdir()?;
    let state = tempfile::tempdir()?;
    let vault = Vault::open(notes.path())?;
    vault.import("good.md", "# Ready\nSynthetic readiness fixture")?;
    let app = App::new(
        Index::open(state.path(), None).await?,
        vault,
        "a".repeat(32),
    );
    let api = router(app.clone());
    let request = |path: &str, authenticated: bool| {
        Request::builder()
            .uri(path)
            .header(
                "authorization",
                if authenticated {
                    format!("Bearer {}", "a".repeat(32))
                } else {
                    String::new()
                },
            )
            .body(Body::empty())
            .unwrap()
    };
    assert_eq!(
        api.clone()
            .oneshot(request("/v1/ready", false))
            .await?
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        api.clone()
            .oneshot(request("/healthz", false))
            .await?
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        api.clone()
            .oneshot(request("/v1/ready", true))
            .await?
            .status(),
        StatusCode::SERVICE_UNAVAILABLE
    );
    app.reconcile().await?;
    assert_eq!(
        api.clone()
            .oneshot(request("/v1/ready", true))
            .await?
            .status(),
        StatusCode::OK
    );
    std::fs::write(notes.path().join("bad.md"), "No managed UUID")?;
    assert!(app.reconcile().await.is_err());
    assert_eq!(app.index.status()?.sources, 1);
    assert_eq!(
        api.clone()
            .oneshot(request("/v1/ready", true))
            .await?
            .status(),
        StatusCode::SERVICE_UNAVAILABLE
    );
    assert_eq!(
        api.clone()
            .oneshot(request("/healthz", false))
            .await?
            .status(),
        StatusCode::OK
    );
    std::fs::remove_file(notes.path().join("bad.md"))?;
    app.reconcile().await?;
    assert_eq!(
        api.clone()
            .oneshot(request("/v1/ready", true))
            .await?
            .status(),
        StatusCode::OK
    );
    drop(api);
    drop(app);
    let app = App::new(
        Index::open(state.path(), None).await?,
        Vault::open(notes.path())?,
        "a".repeat(32),
    );
    assert_eq!(app.index.status()?.sources, 1);
    assert_eq!(
        router(app)
            .oneshot(request("/v1/ready", true))
            .await?
            .status(),
        StatusCode::SERVICE_UNAVAILABLE
    );
    Ok(())
}

#[tokio::test]
async fn inspectable_backlinks_preserve_ambiguous_references() -> Result<()> {
    let notes = tempfile::tempdir()?;
    let state = tempfile::tempdir()?;
    let vault = Vault::open(notes.path())?;
    let origin = vault.import(
        "A.md",
        "# References\n[[B#Detail|caption]] [[Duplicate]] [[Missing]]",
    )?;
    let target = vault.import("B.md", "# Detail\nSource provenance")?;
    vault.import("One/Duplicate.md", "One")?;
    vault.import("Two/Duplicate.md", "Two")?;
    let index = Index::open(state.path(), None).await?;
    index.reconcile(&vault, &CancellationToken::new()).await?;
    let sources = index.sources()?;
    assert_eq!(
        sources.iter().find(|s| s["source_id"] == target).unwrap()["backlinks"],
        serde_json::json!([origin])
    );
    assert_eq!(
        sources.iter().find(|s| s["source_id"] == origin).unwrap()["unresolved_wikilinks"],
        serde_json::json!(["Duplicate", "Missing"])
    );
    Ok(())
}
