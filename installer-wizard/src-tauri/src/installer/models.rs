// Model downloader for the install wizard ( Phase 2 of the tier work ).
//
// Loads the per-tier manifest at compile time ( include_str! the shared
// model-manifest.json that the main app also consumes ) , fetches each
// GGUF from HuggingFace into <install-dir>/models/ , verifies SHA256
// when the manifest provides one , and emits per-file + per-byte progress
// events the renderer can drive a progress bar from.
//
// Range-resume : every download keeps a `.partial` sidecar. On retry the
// fetcher sends `Range: bytes=<existing>-` ; if the server honours it
// ( 206 Partial Content ) , we append. If the server responds 200 ( full
// body ) , we truncate the partial and start over. HF Cloudfront usually
// honours range on LFS blobs ; bytes already on disk save retries .
//
// Failure semantics : `download_all` returns Err on first hard-fail .
// Caller ( install() ) is expected to cleanup any `.partial` files so a
// re-run finds a consistent state. Partials are NOT deleted on success —
// they get atomically renamed to the final filename.

use crate::installer::{ProgressEvent, Tier};
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_LENGTH, RANGE, USER_AGENT};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::Path;
use std::sync::OnceLock;
use tokio::fs::{rename, File, OpenOptions};
use tokio::io::AsyncWriteExt;

// --- Manifest types ------------------------------------------------------

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelManifest {
    pub version: String,
    pub tiers: HashMap<String, TierBundle>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TierBundle {
    pub total_size_bytes: u64,
    pub models: Vec<ModelEntry>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelEntry {
    pub id: String,
    pub role: ModelRole,
    pub filename: String,
    pub url: String,
    pub sha256: Option<String>,
    pub size_bytes: u64,
}

#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ModelRole {
    Llm,
    Embedder,
    Reranker,
}

// Compile-time-bake the manifest into the binary. The .json lives at the
// installer-wizard/ root so the main app TS side can `import` the same file.
const MANIFEST_JSON: &str = include_str!("../../../model-manifest.json");

fn manifest() -> &'static ModelManifest {
    static CACHE: OnceLock<ModelManifest> = OnceLock::new();
    CACHE.get_or_init(|| {
        serde_json::from_str(MANIFEST_JSON).expect("model-manifest.json failed to parse at startup")
    })
}

pub fn bundle_for_tier(tier: Tier) -> &'static TierBundle {
    let key = match tier {
        Tier::Lite => "lite",
        Tier::Standard => "standard",
        Tier::Pro => "pro",
    };
    manifest()
        .tiers
        .get(key)
        .unwrap_or_else(|| panic!("model-manifest.json missing tier '{}'", key))
}

// --- HTTP client ---------------------------------------------------------

fn build_client() -> reqwest::Client {
    let mut headers = HeaderMap::new();
    // Identify ourselves so HF can rate-limit by app rather than tarring
    // us with anonymous-traffic limits. Format follows their guidance.
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static(concat!("loklm-installer/", env!("CARGO_PKG_VERSION"))),
    );
    // HF_TOKEN lifts the anonymous 5 GB/h rate-limit. Optional ; if absent
    // the user runs as anonymous and may get throttled on Pro-tier installs.
    if let Ok(token) = std::env::var("HF_TOKEN") {
        if let Ok(v) = HeaderValue::from_str(&format!("Bearer {}", token)) {
            headers.insert("Authorization", v);
        }
    }
    reqwest::Client::builder()
        .default_headers(headers)
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .expect("reqwest client build failed")
}

// --- Public API ----------------------------------------------------------

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedModel {
    pub id: String,
    pub filename: String,
    pub sha256: String,
    pub size_bytes: u64,
}

// Download every model in `tier`'s bundle to `<install_dir>/models/`.
// `progress` fires for every file boundary AND every chunk while a file is
// in flight ( percent reflects overall bundle progress , 0-100 ).
//
// Returns the per-model summaries ( id + filename + observed sha256 +
// observed bytes ) the caller persists into the tier-marker.
pub async fn download_all<F>(
    install_dir: &Path,
    tier: Tier,
    mut progress: F,
) -> Result<Vec<DownloadedModel>, String>
where
    F: FnMut(ProgressEvent),
{
    let bundle = bundle_for_tier(tier);
    let models_dir = install_dir.join("models");
    tokio::fs::create_dir_all(&models_dir)
        .await
        .map_err(|e| format!("mkdir {} failed : {}", models_dir.display(), e))?;

    let client = build_client();

    let bundle_total = bundle.total_size_bytes.max(1);
    let mut downloaded_far: u64 = 0;
    let mut results = Vec::with_capacity(bundle.models.len());

    for entry in &bundle.models {
        let target = models_dir.join(&entry.filename);
        // Idempotency : if a complete file with the right size + sha256
        // exists , skip. Useful for retries after a mid-bundle failure.
        if let Some(observed_sha) = existing_complete(&target, entry).await? {
            downloaded_far = downloaded_far.saturating_add(entry.size_bytes);
            let observed_size = tokio::fs::metadata(&target)
                .await
                .map(|m| m.len())
                .unwrap_or(entry.size_bytes);
            progress(ProgressEvent {
                step: format!("model-skip:{}", entry.id),
                percent: scale_overall_percent(downloaded_far, bundle_total),
            });
            results.push(DownloadedModel {
                id: entry.id.clone(),
                filename: entry.filename.clone(),
                sha256: observed_sha,
                size_bytes: observed_size,
            });
            continue;
        }

        progress(ProgressEvent {
            step: format!("model-start:{}", entry.id),
            percent: scale_overall_percent(downloaded_far, bundle_total),
        });

        let result = download_one(
            &client,
            entry,
            &target,
            |bytes_in_file| {
                let overall = downloaded_far.saturating_add(bytes_in_file);
                progress(ProgressEvent {
                    step: format!("model-progress:{}", entry.id),
                    percent: scale_overall_percent(overall, bundle_total),
                });
            },
        )
        .await?;

        downloaded_far = downloaded_far.saturating_add(entry.size_bytes);
        progress(ProgressEvent {
            step: format!("model-done:{}", entry.id),
            percent: scale_overall_percent(downloaded_far, bundle_total),
        });
        results.push(result);
    }

    Ok(results)
}

// Sweep leftover .partial files from a previous failed install. Called by
// install() in the failure-cleanup path. Safe to call when no partials
// exist ; does nothing in that case.
pub async fn cleanup_partials(install_dir: &Path) -> std::io::Result<()> {
    let models_dir = install_dir.join("models");
    if !models_dir.exists() {
        return Ok(());
    }
    let mut entries = tokio::fs::read_dir(&models_dir).await?;
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if path.extension().map(|e| e == "partial").unwrap_or(false) {
            let _ = tokio::fs::remove_file(&path).await;
        }
    }
    Ok(())
}

// --- Per-file download ---------------------------------------------------

fn scale_overall_percent(done: u64, total: u64) -> u32 {
    if total == 0 {
        return 0;
    }
    let ratio = (done as f64 / total as f64).clamp(0.0, 1.0);
    (ratio * 100.0) as u32
}

async fn existing_complete(target: &Path, entry: &ModelEntry) -> Result<Option<String>, String> {
    if !target.exists() {
        return Ok(None);
    }
    let meta = tokio::fs::metadata(target)
        .await
        .map_err(|e| format!("stat {} failed : {}", target.display(), e))?;
    // Size-only short-circuit : if we have no expected hash , trust size.
    if entry.sha256.is_none() {
        if meta.len() == entry.size_bytes {
            return Ok(Some(String::new()));
        }
        return Ok(None);
    }
    // Hash check : read + hash + compare.
    let observed = hash_file(target).await?;
    if observed.eq_ignore_ascii_case(entry.sha256.as_deref().unwrap_or("")) {
        Ok(Some(observed))
    } else {
        Ok(None)
    }
}

async fn hash_file(path: &Path) -> Result<String, String> {
    use tokio::io::AsyncReadExt;
    let mut f = File::open(path)
        .await
        .map_err(|e| format!("open {} : {}", path.display(), e))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        let n = f
            .read(&mut buf)
            .await
            .map_err(|e| format!("read {} : {}", path.display(), e))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

async fn download_one<F>(
    client: &reqwest::Client,
    entry: &ModelEntry,
    target: &Path,
    mut on_bytes: F,
) -> Result<DownloadedModel, String>
where
    F: FnMut(u64),
{
    let partial_path = target.with_extension(format!(
        "{}.partial",
        target
            .extension()
            .map(|e| e.to_string_lossy().to_string())
            .unwrap_or_default()
    ));

    // How many bytes do we already have on disk ? Used for Range-resume.
    let mut existing_bytes: u64 = 0;
    if partial_path.exists() {
        if let Ok(m) = tokio::fs::metadata(&partial_path).await {
            existing_bytes = m.len();
        }
    }

    let mut req = client.get(&entry.url);
    if existing_bytes > 0 {
        if let Ok(range) = HeaderValue::from_str(&format!("bytes={}-", existing_bytes)) {
            req = req.header(RANGE, range);
        }
    }

    let response = req
        .send()
        .await
        .map_err(|e| format!("HTTP request failed for {} : {}", entry.id, e))?;

    // If we asked for a range but the server sent 200 ( full body ) , we
    // can't append — truncate and start over.
    let status = response.status();
    let resuming = status.as_u16() == 206;
    if !status.is_success() {
        return Err(format!(
            "download {} failed : HTTP {} from {}",
            entry.id,
            status.as_u16(),
            entry.url
        ));
    }
    if !resuming && existing_bytes > 0 {
        // Server ignored our Range header — discard the partial.
        tokio::fs::remove_file(&partial_path)
            .await
            .map_err(|e| format!("remove stale partial : {}", e))?;
        existing_bytes = 0;
    }

    // Pre-hash the already-on-disk bytes so we end up with a single
    // sha256 covering the whole file ( crucial for resume + verify ).
    let mut hasher = Sha256::new();
    if resuming && existing_bytes > 0 {
        use tokio::io::AsyncReadExt;
        let mut f = File::open(&partial_path)
            .await
            .map_err(|e| format!("reopen partial : {}", e))?;
        let mut buf = vec![0u8; 1024 * 1024];
        loop {
            let n = f
                .read(&mut buf)
                .await
                .map_err(|e| format!("read partial : {}", e))?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
        }
    }

    // Total content-length includes only the remaining bytes when 206 ;
    // we add existing_bytes to know the overall file size for the size
    // sanity check at the end.
    let content_length = response
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok());
    let expected_total = content_length
        .map(|cl| cl + if resuming { existing_bytes } else { 0 })
        .unwrap_or(entry.size_bytes);

    let mut out = OpenOptions::new()
        .write(true)
        .create(true)
        .append(resuming)
        .truncate(!resuming)
        .open(&partial_path)
        .await
        .map_err(|e| format!("open partial {} : {}", partial_path.display(), e))?;

    let mut downloaded: u64 = existing_bytes;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("network read error : {}", e))?;
        hasher.update(&bytes);
        out.write_all(&bytes)
            .await
            .map_err(|e| format!("write to partial : {}", e))?;
        downloaded = downloaded.saturating_add(bytes.len() as u64);
        on_bytes(downloaded);
    }
    out.flush()
        .await
        .map_err(|e| format!("flush partial : {}", e))?;
    drop(out);

    // Sanity check : observed bytes should match the manifest estimate
    // within 5% ( HF sometimes serves slightly different file sizes when
    // a model is re-quantized but the URL stays stable — caught here ).
    let observed_sha = hex::encode(hasher.finalize());
    if let Some(expected_hex) = entry.sha256.as_deref() {
        if !observed_sha.eq_ignore_ascii_case(expected_hex) {
            // Hash mismatch = bad download. Delete the partial so a
            // retry starts fresh ( no risk of resuming corrupted bytes ).
            let _ = tokio::fs::remove_file(&partial_path).await;
            return Err(format!(
                "sha256 mismatch for {} : expected {} , got {}",
                entry.id, expected_hex, observed_sha
            ));
        }
    } else {
        // Size-only fallback when manifest has no SHA256 ( v0.3.0 ships
        // with these as null until the post-release backfill ).
        let pct_off = if expected_total > 0 {
            ((downloaded as i64 - expected_total as i64).abs() as f64)
                / (expected_total as f64)
                * 100.0
        } else {
            0.0
        };
        if expected_total > 0 && pct_off > 5.0 {
            let _ = tokio::fs::remove_file(&partial_path).await;
            return Err(format!(
                "size mismatch for {} : expected {} bytes , got {} ( {:.1}% off )",
                entry.id, expected_total, downloaded, pct_off
            ));
        }
    }

    // Atomically promote partial → final filename so a crash mid-rename
    // can't leave a half-renamed file the next install confuses.
    rename(&partial_path, target)
        .await
        .map_err(|e| format!("rename {} → {} : {}", partial_path.display(), target.display(), e))?;

    Ok(DownloadedModel {
        id: entry.id.clone(),
        filename: entry.filename.clone(),
        sha256: observed_sha,
        size_bytes: downloaded,
    })
}

// --- Tests ---------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_parses_at_startup() {
        let m = manifest();
        assert_eq!(m.version, "0.3.0");
        assert!(m.tiers.contains_key("lite"));
        assert!(m.tiers.contains_key("standard"));
        assert!(m.tiers.contains_key("pro"));
    }

    #[test]
    fn each_tier_has_llm_and_embedder() {
        for key in ["lite", "standard", "pro"] {
            let bundle = manifest().tiers.get(key).expect("tier exists");
            let roles: Vec<ModelRole> = bundle.models.iter().map(|m| m.role).collect();
            assert!(roles.contains(&ModelRole::Llm), "{} missing llm", key);
            assert!(roles.contains(&ModelRole::Embedder), "{} missing embedder", key);
        }
    }

    #[test]
    fn only_lite_skips_reranker() {
        for (key, expect_reranker) in [("lite", false), ("standard", true), ("pro", true)] {
            let bundle = manifest().tiers.get(key).unwrap();
            let has_reranker = bundle
                .models
                .iter()
                .any(|m| m.role == ModelRole::Reranker);
            assert_eq!(has_reranker, expect_reranker, "tier {}", key);
        }
    }

    #[test]
    fn tier_total_bytes_matches_sum_of_models() {
        for key in ["lite", "standard", "pro"] {
            let bundle = manifest().tiers.get(key).unwrap();
            let sum: u64 = bundle.models.iter().map(|m| m.size_bytes).sum();
            // Allow 1 GB slack for round-tripping ; we estimate sizes ,
            // so per-model estimates may not exactly add to the tier
            // total. The point of the assertion is to catch order-of-
            // magnitude drift , not byte-perfect bookkeeping.
            let drift = (bundle.total_size_bytes as i64 - sum as i64).abs();
            assert!(
                drift < 1024 * 1024 * 1024,
                "tier {} total {} drifts from model-sum {} by {} bytes",
                key,
                bundle.total_size_bytes,
                sum,
                drift
            );
        }
    }

    #[test]
    fn bundle_for_tier_dispatches_correctly() {
        assert_eq!(bundle_for_tier(Tier::Lite).models.len(), 2);
        assert_eq!(bundle_for_tier(Tier::Standard).models.len(), 3);
        assert_eq!(bundle_for_tier(Tier::Pro).models.len(), 3);
    }

    #[test]
    fn scale_overall_percent_saturates() {
        assert_eq!(scale_overall_percent(0, 100), 0);
        assert_eq!(scale_overall_percent(50, 100), 50);
        assert_eq!(scale_overall_percent(100, 100), 100);
        // Over-100 saturates ( can happen if Content-Length is wrong ).
        assert_eq!(scale_overall_percent(200, 100), 100);
        // Zero total stays zero ( avoid divide-by-zero panic ).
        assert_eq!(scale_overall_percent(50, 0), 0);
    }
}
