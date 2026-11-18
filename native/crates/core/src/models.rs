use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
pub const EMBEDDING_DIM: usize = 1024;
pub const CODE_QUERY_INSTRUCTION: &str = "Instruct: Given a question about a codebase, retrieve the source code file that answers it.\nQuery: ";
pub const DOC_QUERY_INSTRUCTION: &str =
    "Instruct: Given a question, retrieve the document passage that best answers it.\nQuery: ";
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub enum Embedder {
    BgeM3,
    Qwen3Embedding,
}
pub fn sanitize_passage(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(6000)
        .collect()
}
pub fn prepare_query(model: Embedder, codebase: bool, text: &str) -> String {
    let text = sanitize_passage(text);
    if text.is_empty() {
        return text;
    }
    let prefix = match model {
        Embedder::BgeM3 => "",
        Embedder::Qwen3Embedding if codebase => CODE_QUERY_INSTRUCTION,
        Embedder::Qwen3Embedding => DOC_QUERY_INSTRUCTION,
    };
    format!("{prefix}{text}")
}
pub fn normalize(vector: &mut [f32], dims: usize) -> Result<()> {
    if vector.len() != dims || vector.iter().any(|f| !f.is_finite()) {
        return Err(Error::Invalid("Embedding dimension or values".into()));
    }
    let norm = vector
        .iter()
        .map(|&f| f64::from(f).powi(2))
        .sum::<f64>()
        .sqrt();
    if norm <= f64::EPSILON {
        return Err(Error::Invalid("Zero embedding".into()));
    }
    for f in vector {
        *f = (f64::from(*f) / norm) as f32;
    }
    Ok(())
}
/// Strong identity for NEW indexes. Legacy model stems are preserved but never
/// promoted to a proven hash or mixed across quantizations by this function.
pub fn fingerprint(sha256: &str, dims: usize, model: Embedder, codebase: bool) -> Result<String> {
    if sha256.len() != 64 || !sha256.bytes().all(|c| c.is_ascii_hexdigit()) || dims == 0 {
        return Err(Error::Invalid("Model fingerprint".into()));
    }
    let profile = format!(
        "{}:{dims}:{model:?}:l2:scalar-sanitize-v1:{}",
        sha256.to_lowercase(),
        prepare_query(model, codebase, "query")
    );
    Ok(hex::encode(Sha256::digest(profile.as_bytes())))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn instructions_and_vector_validation() {
        assert_eq!(
            prepare_query(Embedder::BgeM3, false, "  Grüße\nBerlin "),
            "Grüße Berlin"
        );
        assert!(
            prepare_query(Embedder::Qwen3Embedding, true, "auth")
                .starts_with(CODE_QUERY_INSTRUCTION)
        );
        assert!(normalize(&mut [f32::NAN], 1).is_err());
        assert!(normalize(&mut [0.0], 1).is_err());
        let mut v = [3.0, 4.0];
        normalize(&mut v, 2).unwrap();
        assert_eq!(v, [0.6, 0.8]);
    }
}
