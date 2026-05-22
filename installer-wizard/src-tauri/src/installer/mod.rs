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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallOptions {
    pub install_dir: String,
    pub create_desktop_shortcut: bool,
    pub create_start_menu_shortcut: bool,
    pub enable_autostart: bool,
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

pub fn install<F: Fn(ProgressEvent)>(
    options: &InstallOptions,
    version: &str,
    progress: F,
) -> Result<InstallResult, String> {
    platform::install(options, version, progress)
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
