use anyhow::Result;
use axum::{
    Json, Router,
    routing::{get, post},
};
use loklm_knowledge::models::Reranker;
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn raw_http_logits_match_original_rankall_score_domain() -> Result<()> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let endpoint = format!("http://{}/", listener.local_addr()?);
    let client = Reranker::new(&endpoint, "synthetic-raw-logit-v1")?;
    let alias = client.fingerprint.clone();
    let catalog_alias = alias.clone();
    let provider = Router::new()
        .route(
            "/v1/models",
            get(move || {
                let alias = catalog_alias.clone();
                async move { Json(json!({"data":[{"id":alias}]})) }
            }),
        )
        .route(
            "/v1/rerank",
            post(move |Json(input): Json<Value>| {
                let alias = alias.clone();
                async move {
                    assert_eq!(input["model"], alias);
                    // Out-of-order response, negative/extreme logits, and a logit
                    // inside [0,1] catch sorting, overflow and double/domain guesses.
                    Json(json!({"results":[
                        {"index":4,"relevance_score":1000.0},
                        {"index":0,"relevance_score":-1000.0},
                        {"index":3,"relevance_score":2.0},
                        {"index":1,"relevance_score":0.0},
                        {"index":2,"relevance_score":0.5}
                    ]}))
                }
            }),
        );
    let server = tokio::spawn(async move {
        axum::serve(listener, provider).await.unwrap();
    });
    let scores = client
        .rank(
            "Synthetic query",
            &vec!["passage".into(); 5],
            &CancellationToken::new(),
        )
        .await?;
    server.abort();
    assert_eq!(scores[0], 0.0);
    assert_eq!(scores[1], 0.5);
    assert!((scores[2] - 0.6224593312018546).abs() < 1e-12);
    assert!((scores[3] - 0.8807970779778823).abs() < 1e-12);
    assert_eq!(scores[4], 1.0);
    Ok(())
}
