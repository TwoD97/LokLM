use crate::{files::Vault, index::Index};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, State},
    http::{Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::json;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use subtle::ConstantTimeEq;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

pub struct App {
    pub index: Index,
    pub vault: Vault,
    pub token: String,
    pub gate: Mutex<()>,
    pub locked: AtomicBool,
    pub cancel: CancellationToken,
    pub last_error: Mutex<Option<String>>,
    requests: Mutex<std::collections::HashMap<String, CancellationToken>>,
}
impl App {
    pub fn new(index: Index, vault: Vault, token: String) -> Arc<Self> {
        Arc::new(Self {
            index,
            vault,
            token,
            gate: Mutex::new(()),
            locked: AtomicBool::new(false),
            cancel: CancellationToken::new(),
            last_error: Mutex::new(None),
            requests: Mutex::new(std::collections::HashMap::new()),
        })
    }
    pub async fn reconcile(&self) -> anyhow::Result<crate::index::Status> {
        let _guard = self.gate.lock().await;
        anyhow::ensure!(!self.locked.load(Ordering::Acquire), "locked");
        let result = self.index.reconcile(&self.vault, &self.cancel).await;
        // Detailed errors belong to a local administrator; HTTP never leaks paths/content.
        *self.last_error.lock().await = result
            .as_ref()
            .err()
            .map(|_| "reconcile_failed".to_string());
        result
    }
}
pub fn router(app: Arc<App>) -> Router {
    Router::new()
        .route("/healthz", get(|| async { Json(json!({"alive":true})) }))
        .merge(
            Router::new()
                .route("/v1/status", get(status))
                .route("/v1/search", post(search))
                .route("/v1/answer", post(answer))
                .route("/v1/cancel/{id}", post(cancel_request))
                .route("/v1/sources", get(sources))
                .route("/v1/reconcile", post(reconcile))
                .route("/v1/lock", post(lock))
                .layer(middleware::from_fn_with_state(app.clone(), authorize)),
        )
        .layer(DefaultBodyLimit::max(16 * 1024))
        .with_state(app)
}
async fn authorize(
    State(app): State<Arc<App>>,
    request: Request<axum::body::Body>,
    next: Next,
) -> Response {
    let supplied = request
        .headers()
        .get("authorization")
        .and_then(|x| x.to_str().ok())
        .and_then(|x| x.strip_prefix("Bearer "))
        .unwrap_or("");
    if !bool::from(supplied.as_bytes().ct_eq(app.token.as_bytes())) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    next.run(request).await
}
async fn status(State(app): State<Arc<App>>) -> Response {
    if app.locked.load(Ordering::Acquire) {
        return (StatusCode::LOCKED, Json(json!({"locked":true}))).into_response();
    }
    match app.index.status(){Ok(s)=>Json(json!({"api_version":1,"index":s,"fingerprint":app.index.fingerprint,"dense":app.index.model.is_some(),"last_error":*app.last_error.lock().await})).into_response(),Err(_)=>StatusCode::SERVICE_UNAVAILABLE.into_response()}
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Search {
    #[serde(default)]
    request_id: Option<String>,
    query: String,
    #[serde(default)]
    source_ids: Vec<String>,
    #[serde(default = "default_limit")]
    limit: usize,
    #[serde(default)]
    language: Option<loklm_core::qa::Language>,
    #[serde(default)]
    depth: Option<loklm_core::qa::Depth>,
}
fn default_limit() -> usize {
    8
}
async fn search(State(app): State<Arc<App>>, Json(input): Json<Search>) -> Response {
    run_query(app, input, false).await
}
async fn answer(State(app): State<Arc<App>>, Json(input): Json<Search>) -> Response {
    run_query(app, input, true).await
}
async fn run_query(app: Arc<App>, input: Search, answer: bool) -> Response {
    if app.locked.load(Ordering::Acquire) {
        return StatusCode::LOCKED.into_response();
    }
    if answer && app.index.answer.is_none() {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    // One bounded inference operation per instance. No unbounded waiter queue.
    let Ok(_guard) = app.gate.try_lock() else {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    };
    let cancel = app.cancel.child_token();
    let id = input
        .request_id
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    if uuid::Uuid::parse_str(&id).is_err() {
        return StatusCode::BAD_REQUEST.into_response();
    }
    {
        let mut requests = app.requests.lock().await;
        requests.clear();
        requests.insert(id.clone(), cancel.clone());
    }
    let _drop = cancel.clone().drop_guard();
    let response = tokio::time::timeout(
        std::time::Duration::from_secs(if answer { 180 } else { 65 }),
        async {
            let hits = app
                .index
                .search(&input.query, &input.source_ids, input.limit, &cancel)
                .await?;
            if answer {
                let result = app
                    .index
                    .answer
                    .as_ref()
                    .expect("configured answer client")
                    .answer(
                        &input.query,
                        &hits,
                        input.language.unwrap_or(loklm_core::qa::Language::En),
                        input.depth.unwrap_or(loklm_core::qa::Depth::Standard),
                        &cancel,
                    )
                    .await?;
                Ok::<_, anyhow::Error>(json!({"api_version":1,"request_id":id,"result":result}))
            } else {
                Ok(json!({"api_version":1,"request_id":id,"hits":hits}))
            }
        },
    )
    .await;
    app.requests.lock().await.remove(&id);
    if app.locked.load(Ordering::Acquire) {
        return StatusCode::LOCKED.into_response();
    }
    if cancel.is_cancelled() {
        return StatusCode::REQUEST_TIMEOUT.into_response();
    }
    match response {
        Ok(Ok(result)) => Json(result).into_response(),
        Ok(Err(_)) => StatusCode::BAD_REQUEST.into_response(),
        Err(_) => StatusCode::GATEWAY_TIMEOUT.into_response(),
    }
}
async fn cancel_request(State(app): State<Arc<App>>, Path(id): Path<String>) -> Response {
    if let Some(token) = app.requests.lock().await.get(&id) {
        token.cancel();
        StatusCode::NO_CONTENT.into_response()
    } else {
        StatusCode::NOT_FOUND.into_response()
    }
}
async fn sources(State(app): State<Arc<App>>) -> Response {
    if app.locked.load(Ordering::Acquire) {
        return StatusCode::LOCKED.into_response();
    }
    match app.index.sources() {
        Ok(s) => Json(s).into_response(),
        Err(_) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
}
async fn reconcile(State(app): State<Arc<App>>) -> Response {
    if app.locked.load(Ordering::Acquire) {
        return StatusCode::LOCKED.into_response();
    }
    // Background reconciler already serializes; do not accumulate HTTP requests.
    let Ok(_guard) = app.gate.try_lock() else {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    };
    let result = app.index.reconcile(&app.vault, &app.cancel).await;
    *app.last_error.lock().await = result
        .as_ref()
        .err()
        .map(|_| "reconcile_failed".to_string());
    match result {
        Ok(s) => Json(s).into_response(),
        Err(_) => StatusCode::CONFLICT.into_response(),
    }
}
async fn lock(State(app): State<Arc<App>>) -> Response {
    app.locked.store(true, Ordering::Release);
    app.cancel.cancel();
    // Lock is deliberately irreversible in-process. Restart after volume unlock.
    StatusCode::NO_CONTENT.into_response()
}
