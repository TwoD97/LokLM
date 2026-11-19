//! Dedicated llama.cpp transport; prompt/packing/citation semantics belong to core.
//! This opt-in basic QA path does not implement LokLM checked-answer routing.
use crate::index::Hit;
use anyhow::{Result, ensure};
use loklm_core::qa::{self, Depth, Language, Passage};
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

pub const LOCAL_QWEN4B_SHA: &str =
    "00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4";
pub struct AnswerClient {
    http: reqwest::Client,
    endpoint: url::Url,
    pub fingerprint: String,
}
impl AnswerClient {
    pub fn new(endpoint: &str, runtime: &str) -> Result<Self> {
        let endpoint = url::Url::parse(endpoint)?;
        ensure!(
            ["http", "https"].contains(&endpoint.scheme())
                && endpoint.username().is_empty()
                && endpoint.password().is_none(),
            "invalid answer endpoint"
        );
        ensure!(!runtime.is_empty(), "runtime revision required");
        Ok(Self {
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(180))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            endpoint,
            fingerprint: crate::digest(format!(
                "{LOCAL_QWEN4B_SHA}:{runtime}:{}",
                qa::PROMPT_VERSION
            )),
        })
    }
    async fn post(&self, path: &str, body: Value, cancel: &CancellationToken) -> Result<Value> {
        let request = self.http.post(self.endpoint.join(path)?).json(&body).send();
        let response =
            tokio::select! {_=cancel.cancelled()=>anyhow::bail!("cancelled"),r=request=>r?};
        ensure!(
            response.status().is_success(),
            "answer provider unavailable"
        );
        crate::models::bounded_json(response, cancel).await
    }
    pub async fn answer(
        &self,
        question: &str,
        hits: &[Hit],
        language: Language,
        depth: Depth,
        cancel: &CancellationToken,
    ) -> Result<Value> {
        // The HTTP runtime tokenizes rendered ChatML. Until literal-control-token
        // escaping is verified end to end, fail closed on untrusted role markers.
        // Search still returns these documents verbatim; only generation is gated.
        ensure!(
            !question.contains("<|"),
            "literal model control marker in question"
        );
        ensure!(
            hits.iter().all(|h| !h.text.contains("<|")
                && !h.path.contains("<|")
                && h.heading_path.iter().all(|s| !s.contains("<|"))),
            "literal model control marker in evidence"
        );
        if hits.is_empty() {
            return Ok(
                json!({"answer":qa::refusal(language),"citations":[],"validation":"no_evidence","prompt_version":qa::PROMPT_VERSION}),
            );
        }
        let catalog = self.http.get(self.endpoint.join("v1/models")?).send();
        let response =
            tokio::select! {_=cancel.cancelled()=>anyhow::bail!("cancelled"),r=catalog=>r?};
        ensure!(
            response.status().is_success(),
            "answer provider unavailable"
        );
        let catalog: Value = crate::models::bounded_json(response, cancel).await?;
        ensure!(
            catalog["data"].as_array().is_some_and(|a| a
                .iter()
                .any(|m| m["id"].as_str() == Some(&self.fingerprint))),
            "answer model identity mismatch"
        );
        // Positive document numbers are request-local aliases, never persisted IDs.
        // Returned citations map the pair back to UUID + immutable content anchor.
        let mut sources: Vec<_> = hits.iter().map(|h| h.source_id.clone()).collect();
        sources.sort();
        sources.dedup();
        let passages: Vec<_> = hits
            .iter()
            .map(|h| Passage {
                document_id: (sources.binary_search(&h.source_id).unwrap() + 1) as i64,
                chunk_id: h.chunk_id,
                document_title: h.path.clone(),
                text: h.text.clone(),
                heading_path: Some(h.heading_path.clone()),
                page_from: None,
                page_to: None,
                language: None,
                origin: Some(h.origin.clone()),
            })
            .collect();
        let context = 4096usize;
        let max_tokens = qa::answer_max_tokens(context);
        let mut packed = qa::pack_hits_to_budget(&passages, context - max_tokens - 1024, language);
        let messages = loop {
            ensure!(!packed.is_empty(), "no evidence fits context budget");
            let messages = json!([{"role":"system","content":qa::system_prompt(language,depth,false)},
                {"role":"user","content":qa::build_prompt(question,&packed,&[],language,&[],None)}]);
            let rendered = self
                .post(
                    "apply-template",
                    json!({"messages":messages,"chat_template_kwargs":{"enable_thinking":false}}),
                    cancel,
                )
                .await?;
            let prompt = rendered["prompt"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("missing formatted prompt"))?;
            let tokenized = self
                .post(
                    "tokenize",
                    json!({"content":prompt,"add_special":true,"parse_special":true}),
                    cancel,
                )
                .await?;
            let count = tokenized["tokens"]
                .as_array()
                .ok_or_else(|| anyhow::anyhow!("missing actual tokenizer result"))?
                .len();
            if count + max_tokens + qa::CONTEXT_PACK_MARGIN_TOKENS <= context {
                break messages;
            }
            packed.pop();
        };
        let reply=self.post("v1/chat/completions",json!({"model":self.fingerprint,"messages":messages,"stream":false,"max_tokens":max_tokens,
            "temperature":0.2,"chat_template_kwargs":{"enable_thinking":false}}),cancel).await?;
        ensure!(
            reply["model"].as_str() == Some(&self.fingerprint),
            "answer model mismatch"
        );
        ensure!(
            reply["choices"][0]["finish_reason"].as_str() == Some("stop"),
            "incomplete answer"
        );
        let answer = reply["choices"][0]["message"]["content"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("missing answer"))?;
        if answer.trim() == qa::refusal(language) {
            return Ok(
                json!({"answer":answer,"citations":[],"validation":"model_refusal","prompt_version":qa::PROMPT_VERSION}),
            );
        }
        let cited = qa::validate_citations(answer, &packed)?;
        let citations:Vec<_>=cited.iter().map(|p|{let h=hits.iter().find(|h|h.chunk_id==p.chunk_id).expect("validated supplied chunk");
            json!({"marker":qa::marker(p),"source_id":h.source_id,"source_hash":h.source_hash,"anchor":h.anchor,"path":h.path,"open_uri":h.open_uri})}).collect();
        Ok(
            json!({"answer":answer,"citations":citations,"validation":"citation_identity_only","semantic_entailment_checked":false,
            "full_loklm_qa_parity":false,"prompt_version":qa::PROMPT_VERSION,"model_fingerprint":self.fingerprint}),
        )
    }
}
