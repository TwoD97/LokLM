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
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_RANGE, RANGE, USER_AGENT};
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
        // No TOTAL deadline : the payload + CUDA archives are large ( ~0.2-0.5 GB )
        // and a fixed total would guillotine a slow-but-healthy download. read_timeout
        // is a per-read IDLE timeout ( resets on every chunk ) , so only a genuinely
        // stalled connection trips it — the retry + Range-resume in
        // download_and_extract_archive then continues from the .partial.
        .connect_timeout(std::time::Duration::from_secs(30))
        .read_timeout(std::time::Duration::from_secs(60))
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

// RFC 9110 section 14.4: never combine an invalid or mismatched byte range
// with a stored prefix. This downloader publishes only complete files, so an
// unknown total or a response ending before EOF cannot establish success.
fn resumed_total(response: &reqwest::Response, offset: u64) -> Result<u64, String> {
    let invalid = || "Invalid Content-Range for resumed download".to_string();
    let value = response
        .headers()
        .get(CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(invalid)?;
    let (unit, range) = value.split_once(' ').ok_or_else(invalid)?;
    if !unit.eq_ignore_ascii_case("bytes") {
        return Err(invalid());
    }
    let (bounds, total) = range.split_once('/').ok_or_else(invalid)?;
    let (start, end) = bounds.split_once('-').ok_or_else(invalid)?;
    let number = |value: &str| -> Result<u64, String> {
        if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(invalid());
        }
        value.parse().map_err(|_| invalid())
    };
    let (start, end, total) = (number(start)?, number(end)?, number(total)?);
    if start != offset || end < start || end.checked_add(1) != Some(total) {
        return Err(invalid());
    }
    if response
        .content_length()
        .is_some_and(|length| length != total - start)
    {
        return Err("Content-Length does not match resumed byte range".into());
    }
    Ok(total)
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
    let mut resp = request
        .send()
        .await
        .map_err(|e| format!("GET {} : {}", spec.url, e))?;
    let mut resume_offset = existing;
    if resp.status() == reqwest::StatusCode::RANGE_NOT_SATISFIABLE && existing > 0 {
        // A completed or stale partial must not trap all outer retries in 416.
        // Restart once without Range; keep the old partial until a valid full
        // response arrives. A 416 alone is never proof of file integrity.
        drop(resp);
        resp = client
            .get(spec.url)
            .send()
            .await
            .map_err(|e| format!("Restart GET {} : {}", spec.url, e))?;
        resume_offset = 0;
    }
    let status = resp.status();
    if status != reqwest::StatusCode::OK && status != reqwest::StatusCode::PARTIAL_CONTENT {
        return Err(format!("HTTP {} for {}", status.as_u16(), spec.url));
    }
    let server_honoured_range = status.as_u16() == 206;
    let starting_offset = if server_honoured_range {
        resume_offset
    } else {
        0
    };
    let exact_total = if server_honoured_range {
        Some(resumed_total(&resp, starting_offset)?)
    } else {
        resp.content_length()
    };

    // If the server ignored Range ( returned 200 with full body ) we have
    // to start fresh — truncate the partial.
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(starting_offset == 0)
        .append(starting_offset > 0)
        .open(&partial)
        .await
        .map_err(|e| format!("open {} : {}", partial.display(), e))?;

    let total_hint = exact_total.or(spec.expected_size);

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
        let next = written
            .checked_add(chunk.len() as u64)
            .ok_or("Download length overflow")?;
        if exact_total.is_some_and(|total| next > total) {
            return Err("Download body exceeds the declared byte range".into());
        }
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("write : {}", e))?;
        hasher.update(&chunk);
        written = next;
        progress(written, total_hint.unwrap_or(written));
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);

    if exact_total.is_some_and(|total| written != total) {
        return Err("Download body ended before the declared byte range was complete".into());
    }

    let actual = hex::encode(hasher.finalize());
    if let Some(expected) = spec.expected_sha256 {
        if !expected.eq_ignore_ascii_case(&actual) {
            let _ = tokio::fs::remove_file(&partial).await;
            return Err(format!(
                "sha256 mismatch : expected {} , got {}",
                expected, actual
            ));
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn sha(bytes: &[u8]) -> String {
        hex::encode(Sha256::digest(bytes))
    }

    #[tokio::test]
    async fn malformed_or_incomplete_ranges_never_modify_the_partial() {
        for range in [
            None,
            Some("bytes 0-25/26"),
            Some("bytes 10-20/26"),
            Some("bytes 10-25/*"),
            Some("bytes 10-26/26"),
            Some("bytes 10-9/26"),
            Some("items 10-25/26"),
            Some("bytes +10-25/26"),
            Some("bytes 10-18446744073709551615/26"),
        ] {
            let server = MockServer::start().await;
            let mut response = ResponseTemplate::new(206).set_body_bytes(vec![b'x'; 16]);
            if let Some(range) = range {
                response = response.insert_header("content-range", range);
            }
            Mock::given(method("GET"))
                .respond_with(response)
                .mount(&server)
                .await;
            let dir = tempdir().unwrap();
            let dest = dir.path().join("model.gguf");
            std::fs::write(partial_path(&dest), b"0123456789").unwrap();
            let error = download_with_resume(
                &build_client(),
                DownloadSpec {
                    url: &server.uri(),
                    dest: &dest,
                    expected_sha256: None,
                    expected_size: None,
                },
                |_, _| {},
            )
            .await
            .unwrap_err();
            assert!(error.contains("Content-Range"), "{range:?}: {error}");
            assert!(!dest.exists());
            assert_eq!(std::fs::read(partial_path(&dest)).unwrap(), b"0123456789");
        }
    }

    #[tokio::test]
    async fn range_body_length_mismatch_never_modifies_the_partial() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(
                ResponseTemplate::new(206)
                    .set_body_bytes(b"short".to_vec())
                    .insert_header("content-range", "bytes 10-25/26"),
            )
            .mount(&server)
            .await;
        let dir = tempdir().unwrap();
        let dest = dir.path().join("model.gguf");
        std::fs::write(partial_path(&dest), b"0123456789").unwrap();
        let error = download_with_resume(
            &build_client(),
            DownloadSpec {
                url: &server.uri(),
                dest: &dest,
                expected_sha256: None,
                expected_size: None,
            },
            |_, _| {},
        )
        .await
        .unwrap_err();
        assert!(error.contains("Content-Length"), "{error}");
        assert!(!dest.exists());
        assert_eq!(std::fs::read(partial_path(&dest)).unwrap(), b"0123456789");
    }

    #[tokio::test]
    async fn ignored_range_restarts_instead_of_appending() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(header("range", "bytes=3-"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(b"complete".to_vec()))
            .expect(1)
            .mount(&server)
            .await;
        let dir = tempdir().unwrap();
        let dest = dir.path().join("model.gguf");
        std::fs::write(partial_path(&dest), b"old").unwrap();
        let outcome = download_with_resume(
            &build_client(),
            DownloadSpec {
                url: &server.uri(),
                dest: &dest,
                expected_sha256: Some(&sha(b"complete")),
                expected_size: None,
            },
            |_, _| {},
        )
        .await
        .unwrap();
        assert_eq!(outcome.bytes_written, 8);
        assert_eq!(std::fs::read(&dest).unwrap(), b"complete");
    }

    #[tokio::test]
    async fn unsatisfiable_range_restarts_once_without_range() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(header("range", "bytes=3-"))
            .respond_with(ResponseTemplate::new(416).insert_header("content-range", "bytes */3"))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(|request: &wiremock::Request| !request.headers.contains_key("range"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(b"new".to_vec()))
            .expect(1)
            .mount(&server)
            .await;
        let dir = tempdir().unwrap();
        let dest = dir.path().join("model.gguf");
        std::fs::write(partial_path(&dest), b"old").unwrap();
        let outcome = download_with_resume(
            &build_client(),
            DownloadSpec {
                url: &server.uri(),
                dest: &dest,
                expected_sha256: Some(&sha(b"new")),
                expected_size: None,
            },
            |_, _| {},
        )
        .await
        .unwrap();
        assert_eq!(outcome.bytes_written, 3);
        assert_eq!(std::fs::read(&dest).unwrap(), b"new");
    }

    #[tokio::test]
    async fn repeated_416_is_bounded_and_preserves_partial() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(416))
            .expect(2)
            .mount(&server)
            .await;
        let dir = tempdir().unwrap();
        let dest = dir.path().join("model.gguf");
        std::fs::write(partial_path(&dest), b"old").unwrap();
        let error = download_with_resume(
            &build_client(),
            DownloadSpec {
                url: &server.uri(),
                dest: &dest,
                expected_sha256: None,
                expected_size: None,
            },
            |_, _| {},
        )
        .await
        .unwrap_err();
        assert!(error.contains("416"), "{error}");
        assert!(!dest.exists());
        assert_eq!(std::fs::read(partial_path(&dest)).unwrap(), b"old");
    }

    #[tokio::test]
    async fn no_content_response_cannot_publish_an_empty_model() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(204))
            .mount(&server)
            .await;
        let dir = tempdir().unwrap();
        let dest = dir.path().join("model.gguf");
        let error = download_with_resume(
            &build_client(),
            DownloadSpec {
                url: &server.uri(),
                dest: &dest,
                expected_sha256: None,
                expected_size: None,
            },
            |_, _| {},
        )
        .await
        .unwrap_err();
        assert!(error.contains("204"), "{error}");
        assert!(!dest.exists());
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
