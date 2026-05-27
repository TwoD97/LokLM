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

// --- Platform dispatch -----------------------------------------------

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
use windows as platform;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
use linux as platform;

// Fallback for unsupported OSes ( mac is electron-builder dmg territory ,
// not the Tauri wizard ). Compiling on those targets fails loudly here
// rather than silently producing a broken binary.
#[cfg(not(any(target_os = "windows", target_os = "linux")))]
compile_error!("LokLM installer wizard only supports Windows and Linux");

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
