// LokLM installer wizard ( Tauri )
//
// Frontend : ../frontend/index.html , loaded via Tauri's frontendDist
// config. renderer.js calls window.__TAURI__.core.invoke through the
// tauri-bridge.js shim.
//
// Install logic : installer/ submodule dispatches by target_os to
// installer/windows.rs or installer/linux.rs ( robocopy + powershell ,
// or cp -a + .desktop files ). Tauri commands in commands.rs are thin
// wrappers that bridge to the renderer.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod installer;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_state,
            commands::get_license,
            commands::choose_dir,
            commands::install,
            commands::launch,
            commands::close_app,
            commands::minimize_window,
            commands::probe_hardware,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LokLM installer");
}
