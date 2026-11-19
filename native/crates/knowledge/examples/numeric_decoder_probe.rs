//! Model-free decoder comparison over a synthetic vector fixture.
use anyhow::Result;
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize)]
struct Vector {
    vector: Vec<f32>,
}
#[derive(Deserialize)]
struct Corpus {
    rows: Vec<Vector>,
    queries: Vec<Vector>,
}
fn main() -> Result<()> {
    let f64_edge: f64 = serde_json::from_str("0.9999999999999999")?;
    let f32_edge: f32 = serde_json::from_str("1.0000000596046448")?;
    let mut report = json!({
        "f64_edge_bits": format!("{:016x}", f64_edge.to_bits()),
        "f32_midpoint_edge_bits": format!("{:08x}", f32_edge.to_bits())
    });
    if let Some(path) = std::env::args().nth(1) {
        let corpus: Corpus = serde_json::from_slice(&std::fs::read(path)?)?;
        let mut bytes = Vec::new();
        let mut roundtrip_mismatches = 0usize;
        for vector in corpus.rows.iter().chain(&corpus.queries) {
            let restored: Vec<f32> = serde_json::from_str(&serde_json::to_string(&vector.vector)?)?;
            for (&value, restored) in vector.vector.iter().zip(restored) {
                bytes.extend_from_slice(&value.to_bits().to_le_bytes());
                roundtrip_mismatches += usize::from(value.to_bits() != restored.to_bits());
            }
        }
        report["f32_values"] = json!(bytes.len() / 4);
        report["f32_bits_sha256"] = json!(loklm_knowledge::digest(bytes));
        report["checkpoint_roundtrip_mismatches"] = json!(roundtrip_mismatches);
    }
    println!("{}", serde_json::to_string_pretty(&report)?);
    Ok(())
}
