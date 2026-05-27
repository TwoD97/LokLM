// Shared streaming-download primitive used by both the GGUF model
// downloader ( models.rs ) and the payload + cuda downloaders that the
// new download-stub installer adds.
//
// What's shared :
//   * Range-resume against a `<dest>.partial` sidecar
//   * Streaming SHA256 over the full file ( pre-hashes the existing
//     partial bytes when resuming so a single digest covers everything )
//   * Atomic `rename(partial , dest)` on success
//   * Per-chunk progress callback
//
// What's NOT here ( stays caller-side because it's domain-specific ) :
//   * HF_TOKEN auth header             : models.rs builds its own client
//   * Retry-with-backoff orchestration : models.rs wraps this primitive
//                                        in a retry loop , payload code
//                                        retries at the install() level
//   * 5%-tolerance size verification   : models.rs only , because HF
//                                        sometimes re-quantizes and the
//                                        size drifts ; Bunny payloads are
//                                        exact-byte from a known upload

use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, RANGE, USER_AGENT};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tokio::fs::{rename, File, OpenOptions};
use tokio::io::AsyncWriteExt;

/// Minimal default-headers reqwest client : just the User-Agent. Add any
/// service-specific headers ( Authorization for HF , etc. ) by building a
/// dedicated `reqwest::Client` and passing it to `download_with_resume`.
pub fn build_client() -> reqwest::Client {
    let mut headers = HeaderMap::new();
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static(concat!("loklm-installer/", env!("CARGO_PKG_VERSION"))),
    );
    reqwest::Client::builder()
        .default_headers(headers)
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .expect("reqwest client build failed")
}

pub struct DownloadSpec<'a> {
    pub url: &'a str,
    pub dest: &'a Path,
    /// When Some , the final digest is compared and a mismatch aborts the
    /// download ( deleting the partial ). When None , the digest is still
    /// computed and returned but never compared.
    pub expected_sha256: Option<&'a str>,
    /// Used only to seed the progress callback's total when the server
    /// doesn't send a Content-Length. Not used for verification.
    pub expected_size: Option<u64>,
}

#[derive(Debug)]
pub struct DownloadOutcome {
    pub bytes_written: u64,
    pub sha256: String,
}

fn partial_path(dest: &Path) -> PathBuf {
    // We want `<dest>.partial` regardless of extension. e.g.
    //   foo.tar.zst -> foo.tar.zst.partial
    //   gguf        -> gguf.partial
    // `with_extension` replaces the LAST extension component , so for
    // multi-dot names like `.tar.zst` it'd drop `.zst`. Append manually.
    let mut s = dest.as_os_str().to_owned();
    s.push(".partial");
    PathBuf::from(s)
}

pub async fn download_with_resume<F>(
    client: &reqwest::Client,
    spec: DownloadSpec<'_>,
    mut progress: F,
) -> Result<DownloadOutcome, String>
where
    F: FnMut(u64, u64) + Send,
{
    let partial = partial_path(spec.dest);

    let existing = tokio::fs::metadata(&partial)
        .await
        .map(|m| m.len())
        .unwrap_or(0);

    let mut request = client.get(spec.url);
    if existing > 0 {
        if let Ok(v) = HeaderValue::from_str(&format!("bytes={}-", existing)) {
            request = request.header(RANGE, v);
        }
    }
    let resp = request
        .send()
        .await
        .map_err(|e| format!("GET {} : {}", spec.url, e))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("HTTP {} for {}", status.as_u16(), spec.url));
    }
    let server_honoured_range = status.as_u16() == 206;
    let starting_offset = if server_honoured_range { existing } else { 0 };

    // If the server ignored Range ( returned 200 with full body ) we have
    // to start fresh — truncate the partial.
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(!server_honoured_range)
        .append(server_honoured_range)
        .open(&partial)
        .await
        .map_err(|e| format!("open {} : {}", partial.display(), e))?;

    let content_length = resp.content_length();
    let total_hint = content_length
        .map(|n| n.saturating_add(starting_offset))
        .or(spec.expected_size);

    // Pre-hash the bytes we already have on disk so the final digest
    // covers the whole file , not just the resumed tail.
    let mut hasher = Sha256::new();
    if starting_offset > 0 {
        use tokio::io::AsyncReadExt;
        let mut existing_file = File::open(&partial)
            .await
            .map_err(|e| format!("re-open partial for hashing : {}", e))?;
        let mut buf = vec![0u8; 1024 * 1024];
        loop {
            let n = existing_file
                .read(&mut buf)
                .await
                .map_err(|e| format!("read partial : {}", e))?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
        }
    }

    let mut written = starting_offset;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("stream : {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("write : {}", e))?;
        hasher.update(&chunk);
        written = written.saturating_add(chunk.len() as u64);
        progress(written, total_hint.unwrap_or(written));
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);

    let actual = hex::encode(hasher.finalize());
    if let Some(expected) = spec.expected_sha256 {
        if !expected.eq_ignore_ascii_case(&actual) {
            let _ = tokio::fs::remove_file(&partial).await;
            return Err(format!("sha256 mismatch : expected {} , got {}", expected, actual));
        }
    }

    rename(&partial, spec.dest).await.map_err(|e| {
        format!(
            "rename {} → {} : {}",
            partial.display(),
            spec.dest.display(),
            e
        )
    })?;
    Ok(DownloadOutcome {
        bytes_written: written,
        sha256: actual,
    })
}

pub async fn cleanup_partial(dest: &Path) {
    let _ = tokio::fs::remove_file(partial_path(dest)).await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn sha(bytes: &[u8]) -> String {
        hex::encode(Sha256::digest(bytes))
    }

    #[tokio::test]
    async fn full_download_writes_file_and_verifies_sha() {
        let server = MockServer::start().await;
        let body = b"hello world".to_vec();
        let expected = sha(&body);
        Mock::given(method("GET"))
            .and(path("/file"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(body.clone()))
            .mount(&server)
            .await;

        let dir = tempdir().unwrap();
        let dest = dir.path().join("out.bin");
        let client = build_client();
        let outcome = download_with_resume(
            &client,
            DownloadSpec {
                url: &format!("{}/file", server.uri()),
                dest: &dest,
                expected_sha256: Some(&expected),
                expected_size: Some(body.len() as u64),
            },
            |_, _| {},
        )
        .await
        .expect("download ok");
        assert_eq!(outcome.sha256, expected);
        assert_eq!(std::fs::read(&dest).unwrap(), body);
    }

    #[tokio::test]
    async fn sha_mismatch_returns_err_and_removes_partial() {
        let server = MockServer::start().await;
        let body = b"abc".to_vec();
        Mock::given(method("GET"))
            .and(path("/file"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(body))
            .mount(&server)
            .await;

        let dir = tempdir().unwrap();
        let dest = dir.path().join("out.bin");
        let client = build_client();
        let err = download_with_resume(
            &client,
            DownloadSpec {
                url: &format!("{}/file", server.uri()),
                dest: &dest,
                expected_sha256: Some(&"00".repeat(32)),
                expected_size: None,
            },
            |_, _| {},
        )
        .await
        .unwrap_err();
        assert!(err.contains("sha256 mismatch"), "got : {}", err);
        assert!(!partial_path(&dest).exists());
    }

    #[tokio::test]
    async fn range_resume_continues_from_partial_and_hashes_full_body() {
        let full = b"abcdefghijklmnopqrstuvwxyz".to_vec();
        let expected = sha(&full);

        let server = MockServer::start().await;
        // Server only honours Range requests : returns 206 with the tail
        // bytes when Range header is present.
        Mock::given(method("GET"))
            .and(path("/file"))
            .respond_with(
                ResponseTemplate::new(206)
                    .set_body_bytes(full[10..].to_vec())
                    .insert_header(
                        "content-range",
                        format!("bytes 10-{}/{}", full.len() - 1, full.len()).as_str(),
                    ),
            )
            .mount(&server)
            .await;

        let dir = tempdir().unwrap();
        let dest = dir.path().join("out.bin");
        // Simulate previous crash : the first 10 bytes are already on disk.
        std::fs::write(partial_path(&dest), &full[..10]).unwrap();

        let client = build_client();
        let outcome = download_with_resume(
            &client,
            DownloadSpec {
                url: &format!("{}/file", server.uri()),
                dest: &dest,
                expected_sha256: Some(&expected),
                expected_size: Some(full.len() as u64),
            },
            |_, _| {},
        )
        .await
        .expect("resume ok");
        assert_eq!(outcome.sha256, expected);
        assert_eq!(std::fs::read(&dest).unwrap(), full);
    }
}
