// Cross-platform install logic for the LokLM wizard.
//
// Shared types ( InstallOptions , InstallResult , InstallerState ,
// ProgressEvent ) live here ; platform-specific work ( registry on
// Windows , XDG paths + .desktop files on Linux ) is in the per-OS
// submodules and selected at compile time via #[cfg(target_os = "...")].
//
// The public surface ( install , get_state , get_license , launch ,
// dialog_default_path ) mirrors what commands.rs binds to Tauri ; each
// platform module implements the same set.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub mod archive;
pub mod download;
pub mod hardware;
pub mod models;
pub mod payload_manifest;
pub use hardware::{HardwareProfile, Tier};
pub use models::{cleanup_partials, download_all};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallOptions {
    pub install_dir: String,
    pub create_desktop_shortcut: bool,
    pub create_start_menu_shortcut: bool,
    pub enable_autostart: bool,
    // v0.3.0+ : tier picked by the user on the hardware-check page.
    // Drives which model bundle the wizard downloads in phase 2 and is
    // persisted into the tier-marker JSON. Optional for backwards-compat
    // with any caller that hasn't been updated yet ; defaults to Standard.
    #[serde(default = "default_tier")]
    pub tier: Tier,
    // Optional hardware snapshot collected by the renderer during the
    // hardware-check page. Persisted into the marker for support /
    // debugging. Stored as raw serde_json::Value rather than a typed
    // HardwareProfile so that ANY field-shape mismatch ( e.g. a number
    // that lost precision crossing the JS-Rust JSON boundary , as happens
    // when wgpu returns u64::MAX for max_buffer_size ) doesn't kill the
    // entire install. The marker writer round-trips it as-is.
    #[serde(default)]
    pub hardware_snapshot: Option<serde_json::Value>,
    // v0.3.0+ : whether the wizard should additionally fetch the CUDA
    // llama-cpp variant from Bunny and extract it on top of the base
    // payload. Default false ; renderer flips it on when hardware probe
    // detects an NVIDIA Pascal+ card. Hidden on mac entirely.
    #[serde(default)]
    pub download_cuda: bool,
    // v0.4.1+ : opt-in for the external Ollama connector. Default false —
    // the user has to tick the checkbox on the options page ( "at your own
    // risk" wording lives there ). Persisted into the tier marker ; the
    // main app keeps the connector locked when this is false.
    #[serde(default)]
    pub enable_ollama_connector: bool,
}

fn default_tier() -> Tier {
    Tier::Standard
}

// ---- Tier marker --------------------------------------------------------

// Shape persisted to <install-dir>/loklm-tier.json. Read by the main app
// on startup to decide which models to load and which feature-gates to
// expose. See plan-doc for the full rationale.
//
// `models` stays empty in Phase 1 — Phase 2's downloader populates it
// with one entry per downloaded GGUF ( id + sha256 ). The main app
// tolerates an empty array : it falls back to file-system scan to figure
// out which models are present.

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TierMarker<'a> {
    pub tier: Tier,
    pub installed_at: String,
    pub installer_version: &'a str,
    pub hardware: Option<&'a serde_json::Value>,
    pub models: Vec<ModelManifestEntry>,
    // Install-time opt-in for the external Ollama connector. Markers from
    // installers older than this field simply lack the key ; the main app
    // treats a missing key as "enabled" so pre-existing setups keep working.
    pub ollama_connector: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelManifestEntry {
    pub id: String,
    pub sha256: String,
}

const TIER_MARKER_FILENAME: &str = "loklm-tier.json";

pub fn write_tier_marker(
    install_dir: &std::path::Path,
    options: &InstallOptions,
    version: &str,
    downloaded: &[models::DownloadedModel],
) -> std::io::Result<std::path::PathBuf> {
    use time::format_description::well_known::Rfc3339;

    let now = time::OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| String::from("unknown"));

    let marker = TierMarker {
        tier: options.tier,
        installed_at: now,
        installer_version: version,
        hardware: options.hardware_snapshot.as_ref(),
        models: downloaded
            .iter()
            .map(|d| ModelManifestEntry {
                id: d.id.clone(),
                sha256: d.sha256.clone(),
            })
            .collect(),
        ollama_connector: options.enable_ollama_connector,
    };

    let path = install_dir.join(TIER_MARKER_FILENAME);
    let json = serde_json::to_string_pretty(&marker)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    std::fs::write(&path, json)?;
    Ok(path)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub install_dir: String,
    pub app_exe_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallerState {
    pub default_install_dir: String,
    pub existing_install_dir: Option<String>,
    pub payload_ready: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct ProgressEvent {
    pub step: String,
    pub percent: u32,
}

// --- Resilient archive download + extract ----------------------------

// Download a tar.zst archive ( payload , or the ~0.5 GB CUDA addon ) and extract
// it , retrying with Range-RESUME on transient failures. A single GET over a flaky
// or slow link regularly drops mid-stream — reqwest surfaces that as "error
// decoding response body" — and the CUDA archive is the biggest single download ,
// so it gets hit most. The key over a naive retry : the `<dest>.partial` sidecar
// is KEPT across attempts , so each retry continues from where the stream broke
// ( a `Range` request ) instead of re-fetching the whole file. download_with_resume's
// streaming sha256 is the integrity backstop — a corrupted resume fails the hash
// and that path clears the partial itself — so a deterministic sha / size mismatch
// is NOT retried ( the source bytes won't change ).
async fn download_and_extract_archive<F>(
    client: &reqwest::Client,
    url: &str,
    archive_path: &std::path::Path,
    expected_sha256: &str,
    expected_size: u64,
    extract_dest: &std::path::Path,
    label: &str,
    mut on_progress: F,
) -> Result<(), String>
where
    F: FnMut(u64, u64) + Send,
{
    const MAX_ATTEMPTS: u32 = 5;
    let mut attempt = 0u32;
    loop {
        attempt += 1;
        let outcome: Result<(), String> = async {
            download::download_with_resume(
                client,
                download::DownloadSpec {
                    url,
                    dest: archive_path,
                    expected_sha256: Some(expected_sha256),
                    expected_size: Some(expected_size),
                },
                |written, total| on_progress(written, total),
            )
            .await
            .map_err(|e| format!("{} download : {}", label, e))?;
            archive::extract_tar_zst(archive_path, extract_dest)
                .map_err(|e| format!("{} extract : {}", label, e))?;
            Ok(())
        }
        .await;
        match outcome {
            Ok(()) => break,
            // Deterministic : same bytes on retry , so fail fast instead of looping.
            Err(e) if e.contains("sha256 mismatch") || e.contains("size mismatch") => {
                return Err(e);
            }
            Err(e) if attempt >= MAX_ATTEMPTS => return Err(e),
            Err(_) => {
                // KEEP the .partial so the next attempt resumes via Range. Linear
                // backoff ( 2s , 4s , … ) to ride out a transient network / proxy blip.
                tokio::time::sleep(std::time::Duration::from_secs(2 * attempt as u64)).await;
            }
        }
    }
    let _ = std::fs::remove_file(archive_path);
    Ok(())
}

// --- Platform dispatch -----------------------------------------------

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
use windows as platform;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
use linux as platform;

#[cfg(target_os = "macos")]
mod mac;
#[cfg(target_os = "macos")]
use mac as platform;

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
compile_error!("LokLM installer wizard supports Windows , Linux , and macOS");

// --- Public API ( delegates to platform module ) ---------------------

pub async fn install<F>(
    options: &InstallOptions,
    version: &str,
    progress: F,
) -> Result<InstallResult, String>
where
    F: FnMut(ProgressEvent) + Send,
{
    platform::install(options, version, progress).await
}

pub fn get_state() -> InstallerState {
    platform::get_state()
}

pub fn get_license() -> Option<String> {
    platform::get_license()
}

pub fn launch(app_exe_path: &str) -> Result<(), String> {
    platform::launch(app_exe_path)
}

pub fn dialog_default_path(current: Option<&str>) -> PathBuf {
    platform::dialog_default_path(current)
}

pub fn probe_hardware() -> HardwareProfile {
    hardware::probe()
}
