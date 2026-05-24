// Tauri command handlers — thin wrappers that translate between JS land
// ( window.__TAURI__.core.invoke ) and the install logic in installer.rs.
//
// Names match the kebab-case channel names the electron version used
// ( installer:get-state , installer:install , etc. ) translated to
// snake_case for Tauri's command naming.

use crate::installer::{
    self, HardwareProfile, InstallOptions, InstallResult, InstallerState, ProgressEvent,
};
use tauri::{AppHandle, Emitter, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub fn get_state() -> InstallerState {
    installer::get_state()
}

#[tauri::command]
pub fn get_license() -> Option<String> {
    installer::get_license()
}

// Opens a directory picker. Resolves to None on cancel.
//
// Tauri's dialog plugin is async-callback based on Windows ( the native
// IFileDialog is COM and runs on the UI thread ) ; we wrap it in a
// oneshot channel to await from the command.
#[tauri::command]
pub async fn choose_dir(app: AppHandle, current: Option<String>) -> Option<String> {
    let default_path = installer::dialog_default_path(current.as_deref());
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_directory(&default_path)
        .pick_folder(move |path| {
            let _ = tx.send(path);
        });
    let result = rx.await.ok()??;
    Some(result.to_string())
}

#[tauri::command]
pub async fn install(
    window: WebviewWindow,
    app: AppHandle,
    options: InstallOptions,
) -> Result<InstallResult, String> {
    let version = app.package_info().version.to_string();
    let emit_window = window.clone();
    // Move heavy install work to a blocking thread — robocopy + reg.exe
    // calls would otherwise stall Tauri's UI thread for several seconds.
    tokio::task::spawn_blocking(move || {
        installer::install(&options, &version, |progress: ProgressEvent| {
            let _ = emit_window.emit("installer:progress", progress);
        })
    })
    .await
    .map_err(|e| format!("install task panicked : {}", e))?
}

#[tauri::command]
pub fn launch(app_exe_path: String) -> Result<(), String> {
    installer::launch(&app_exe_path)
}

// Probes GPU ( wgpu enumerate_adapters ) , RAM and CPU ( sysinfo ) and
// returns a recommended tier. Wgpu init can take 200-500ms on first call
// while the driver spins up — run on a blocking task so the UI thread
// stays responsive.
#[tauri::command]
pub async fn probe_hardware() -> Result<HardwareProfile, String> {
    tokio::task::spawn_blocking(installer::probe_hardware)
        .await
        .map_err(|e| format!("hardware probe panicked : {}", e))
}

#[tauri::command]
pub fn close_app(window: WebviewWindow) {
    let _ = window.close();
}

#[tauri::command]
pub fn minimize_window(window: WebviewWindow) {
    let _ = window.minimize();
}
