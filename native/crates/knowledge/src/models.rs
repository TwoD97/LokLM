use anyhow::{Result, ensure};
use loklm_core::models::{self, Embedder};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, clap::ValueEnum)]
#[serde(rename_all = "lowercase")]
pub enum Profile {
    Lite,
    Standard,
    Pro,
}
impl Profile {
    pub fn embedder(self) -> Embedder {
        match self {
            Self::Lite => Embedder::BgeM3,
            _ => Embedder::Qwen3Embedding,
        }
    }
    pub fn sha(self) -> &'static str {
        match self {
            Self::Lite => "e251234fcb7d050991a6be491952f485bf5c641dd10c3272dc1301fd281ad50f",
            _ => "06507c7b42688469c4e7298b0a1e16deff06caf291cf0a5b278c308249c3e439",
        }
    }
    pub fn fingerprint(self) -> String {
        models::fingerprint(self.sha(), 1024, self.embedder(), false).expect("pinned profile")
    }
}

#[derive(Clone)]
pub struct ModelClient {
    http: reqwest::Client,
    endpoint: url::Url,
    pub profile: Profile,
    pub fingerprint: String,
}
impl ModelClient {
    pub fn new(endpoint: &str, profile: Profile, runtime_revision: &str) -> Result<Self> {
        let endpoint = url::Url::parse(endpoint)?;
        ensure!(
            ["http", "https"].contains(&endpoint.scheme())
                && endpoint.username().is_empty()
                && endpoint.password().is_none(),
            "invalid model endpoint"
        );
        ensure!(
            !runtime_revision.is_empty(),
            "model runtime revision required"
        );
        let fingerprint = crate::digest(format!("{}:{runtime_revision}", profile.fingerprint()));
        Ok(Self {
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(60))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            endpoint,
            profile,
            fingerprint,
        })
    }
    /// The dedicated server must advertise its verified fingerprint as model alias.
    /// This deliberately rejects an unrelated active Ollama/voice session endpoint.
    pub async fn embed(
        &self,
        texts: &[String],
        query: bool,
        cancel: &CancellationToken,
    ) -> Result<Vec<Vec<f32>>> {
        ensure!(texts.len() <= 16, "embedding batch exceeds limit");
        let catalog_request = self.http.get(self.endpoint.join("v1/models")?).send();
        let response = tokio::select! { _ = cancel.cancelled()=>anyhow::bail!("cancelled"), r=catalog_request=>r? };
        ensure!(
            response.status().is_success(),
            "embedding provider unavailable"
        );
        let catalog: serde_json::Value = bounded_json(response, cancel).await?;
        ensure!(
            catalog["data"].as_array().is_some_and(|a| a
                .iter()
                .any(|m| m["id"].as_str() == Some(self.fingerprint.as_str()))),
            "embedding model identity mismatch"
        );
        let input: Vec<_> = texts
            .iter()
            .map(|t| {
                if query {
                    models::prepare_query(self.profile.embedder(), false, t)
                } else {
                    models::sanitize_passage(t)
                }
            })
            .collect();
        let request = self
            .http
            .post(self.endpoint.join("v1/embeddings")?)
            .json(&serde_json::json!({"model":self.fingerprint,"input":input}))
            .send();
        let response =
            tokio::select! {_ = cancel.cancelled()=>anyhow::bail!("cancelled"),r=request=>r?};
        ensure!(
            response.status().is_success(),
            "embedding provider unavailable"
        );
        ensure!(
            response.content_length().unwrap_or(0) < 2_000_000,
            "embedding response too large"
        );
        let data: Embeddings = bounded_json(response, cancel).await?;
        ensure!(data.model == self.fingerprint, "model identity mismatch");
        let mut data = data.data;
        data.sort_by_key(|v| v.index);
        ensure!(data.len() == texts.len(), "incomplete embeddings");
        let mut out = Vec::new();
        for (i, mut entry) in data.into_iter().enumerate() {
            ensure!(entry.index == i, "duplicate embedding index");
            models::normalize(&mut entry.embedding, 1024)?;
            out.push(entry.embedding);
        }
        Ok(out)
    }
}
pub(crate) async fn bounded_json<T: serde::de::DeserializeOwned>(
    mut response: reqwest::Response,
    cancel: &CancellationToken,
) -> Result<T> {
    let mut bytes = Vec::new();
    loop {
        let chunk = tokio::select! {_ = cancel.cancelled()=>anyhow::bail!("cancelled"),r=response.chunk()=>r?};
        let Some(chunk) = chunk else {
            break;
        };
        ensure!(
            bytes.len() + chunk.len() <= 2_000_000,
            "model response exceeds limit"
        );
        bytes.extend_from_slice(&chunk);
    }
    Ok(serde_json::from_slice(&bytes)?)
}

pub struct Reranker {
    http: reqwest::Client,
    endpoint: url::Url,
    pub fingerprint: String,
}
impl Reranker {
    pub fn new(endpoint: &str, runtime: &str) -> Result<Self> {
        let endpoint = url::Url::parse(endpoint)?;
        ensure!(
            ["http", "https"].contains(&endpoint.scheme())
                && endpoint.username().is_empty()
                && endpoint.password().is_none(),
            "invalid reranker endpoint"
        );
        ensure!(!runtime.is_empty(), "reranker runtime revision required");
        let fingerprint = crate::digest(format!(
            "e186a244ed455b4ab66ec64339ce7427a6ae13f5c0b5e544de96e50f0f8b3673:{runtime}:bge-reranker-v2-m3"
        ));
        Ok(Self {
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(60))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            endpoint,
            fingerprint,
        })
    }
    pub async fn rank(
        &self,
        query: &str,
        docs: &[String],
        cancel: &CancellationToken,
    ) -> Result<Vec<f64>> {
        ensure!(docs.len() <= 100, "reranker candidate limit");
        // Verify model catalog because llama.cpp rerank response merely echoes
        // the request's model field; echoing alone is not identity evidence.
        let request = self.http.get(self.endpoint.join("v1/models")?).send();
        let response =
            tokio::select! {_ = cancel.cancelled()=>anyhow::bail!("cancelled"),r=request=>r?};
        ensure!(response.status().is_success(), "reranker unavailable");
        let catalog: serde_json::Value = bounded_json(response, cancel).await?;
        ensure!(
            catalog["data"].as_array().is_some_and(|a| a
                .iter()
                .any(|m| m["id"].as_str() == Some(self.fingerprint.as_str()))),
            "reranker identity mismatch"
        );
        let docs: Vec<String> = docs
            .iter()
            .map(|t| t.chars().take(2800).collect())
            .collect();
        let request = self
            .http
            .post(self.endpoint.join("v1/rerank")?)
            .json(&serde_json::json!({"model":self.fingerprint,"query":query,"documents":docs}))
            .send();
        let response =
            tokio::select! {_ = cancel.cancelled()=>anyhow::bail!("cancelled"),r=request=>r?};
        ensure!(response.status().is_success(), "reranker unavailable");
        #[derive(Deserialize)]
        struct Row {
            index: usize,
            relevance_score: f64,
        }
        #[derive(Deserialize)]
        struct Reply {
            results: Vec<Row>,
        }
        let reply: Reply = bounded_json(response, cancel).await?;
        let mut scores = vec![None; docs.len()];
        for row in reply.results {
            ensure!(
                row.index < scores.len()
                    && scores[row.index].is_none()
                    && row.relevance_score.is_finite(),
                "invalid rerank result"
            );
            scores[row.index] = Some(row.relevance_score);
        }
        scores
            .into_iter()
            .map(|s| s.ok_or_else(|| anyhow::anyhow!("incomplete rerank result")))
            .collect()
    }
}
#[derive(Deserialize)]
struct Embeddings {
    model: String,
    data: Vec<Embedding>,
}
#[derive(Deserialize)]
struct Embedding {
    index: usize,
    embedding: Vec<f32>,
}
