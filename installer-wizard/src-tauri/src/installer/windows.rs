// Windows install backend : registry-based uninstall entry , PowerShell
// COM .lnk shortcuts , robocopy file copy , Run-key autostart.
//
// All external-tool invocations go through cmd() / cmd_path() helpers
// so the CREATE_NO_WINDOW flag is set on every reg.exe / robocopy /
// powershell spawn — otherwise the user sees 20+ console flashes
// during install.

#![cfg(target_os = "windows")]

use super::{InstallOptions, InstallResult, InstallerState, ProgressEvent};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn cmd(program: &str) -> Command {
    let mut c = Command::new(program);
    c.creation_flags(CREATE_NO_WINDOW);
    c
}

fn cmd_path(path: PathBuf) -> Command {
    let mut c = Command::new(path);
    c.creation_flags(CREATE_NO_WINDOW);
    c
}

const PRODUCT_NAME: &str = "LokLM";
const APP_EXE: &str = "LokLM.exe";
const UNINSTALL_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\LokLM";
const SETUP_KEY: &str = r"HKCU\Software\LokLM\Setup";
const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";

// ----------------------------------------------------------------
// Path resolution
// ----------------------------------------------------------------

fn local_programs_dir() -> PathBuf {
    let root = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| {
        let home = std::env::var("USERPROFILE").unwrap_or_default();
        format!("{}\\AppData\\Local", home)
    });
    PathBuf::from(root).join("Programs")
}

fn default_install_dir() -> PathBuf {
    local_programs_dir().join(PRODUCT_NAME)
}

// Locate the LokLM payload ( win-unpacked dir with LokLM.exe + dlls ).
// Two layouts checked , in order :
//   1. Packaged : sibling of the installer exe ( $INSTDIR\win-unpacked
//      relative to $INSTDIR\installer\<wizard>.exe ). This is the
//      NSIS-stub layout the portable wrapper produces.
//   2. Dev : ../../release/win-unpacked relative to this binary , for
//      running the wizard out of cargo target without packaging.
fn payload_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let exe_dir = exe.parent()?;

    let sibling = exe_dir.parent().map(|p| p.join("win-unpacked"));
    if let Some(p) = &sibling {
        if p.join(APP_EXE).exists() {
            return Some(p.clone());
        }
    }

    // Dev fallback : we're running installer-wizard/src-tauri/target/release/<exe>
    // and need to reach <repo>/release/win-unpacked.
    let dev = exe_dir
        .join("..")
        .join("..")
        .join("..")
        .join("..")
        .join("release")
        .join("win-unpacked");
    if dev.join(APP_EXE).exists() {
        return Some(dev);
    }
    None
}

fn license_file_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let exe_dir = exe.parent()?;
    // NSIS extracts LICENSE alongside the wizard exe ( stub.nsi puts it at
    // $INSTDIR\installer\LICENSE — same layout as Linux's makeself stub ).
    // The `resources/LICENSE` fallback is left for a hypothetical future
    // where we switch back to tauri-bundler , which would put it there.
    let alongside = exe_dir.join("LICENSE");
    if alongside.exists() {
        return Some(alongside);
    }
    let resources = exe_dir.join("resources").join("LICENSE");
    if resources.exists() {
        return Some(resources);
    }
    // Dev fallback : running the wizard out of cargo target , LICENSE
    // lives at <repo>/LICENSE which is four parents up from
    // installer-wizard/src-tauri/target/release/<exe>.
    let dev = exe_dir
        .join("..")
        .join("..")
        .join("..")
        .join("..")
        .join("LICENSE");
    if dev.exists() {
        Some(dev)
    } else {
        None
    }
}

// ----------------------------------------------------------------
// Registry via reg.exe
// ----------------------------------------------------------------

fn reg_exe() -> PathBuf {
    let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
    PathBuf::from(system_root).join("System32").join("reg.exe")
}

fn reg_add(key: &str, name: &str, ty: &str, value: &str) -> std::io::Result<()> {
    let status = cmd_path(reg_exe())
        .args(["add", key, "/v", name, "/t", ty, "/d", value, "/f"])
        .status()?;
    if !status.success() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("reg add {} failed : exit {}", key, status),
        ));
    }
    Ok(())
}

fn reg_query_value(key: &str, name: &str) -> Option<String> {
    let out = cmd_path(reg_exe())
        .args(["query", key, "/v", name])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with(name) {
            let parts: Vec<&str> = trimmed.splitn(3, char::is_whitespace).collect();
            if parts.len() >= 3 {
                return Some(parts[2].trim().to_string());
            }
        }
    }
    None
}

fn reg_delete_value(key: &str, name: &str) {
    let _ = cmd_path(reg_exe())
        .args(["delete", key, "/v", name, "/f"])
        .status();
}

// ----------------------------------------------------------------
// Existing install detection
// ----------------------------------------------------------------

fn existing_install_dir() -> Option<PathBuf> {
    let from_registry = reg_query_value(UNINSTALL_KEY, "InstallLocation").map(PathBuf::from);
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(p) = from_registry {
        candidates.push(p);
    }
    candidates.push(default_install_dir());
    candidates.push(local_programs_dir().join("loklm"));

    for c in candidates {
        if c.join(APP_EXE).exists() {
            return Some(c);
        }
    }
    None
}

fn suggested_install_dir() -> PathBuf {
    existing_install_dir().unwrap_or_else(default_install_dir)
}

pub fn dialog_default_path(current: Option<&str>) -> PathBuf {
    let mut candidate = current
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(suggested_install_dir);

    loop {
        if candidate.exists() {
            return candidate;
        }
        let parent = candidate.parent().map(|p| p.to_path_buf());
        match parent {
            Some(p) if p != candidate => candidate = p,
            _ => return local_programs_dir(),
        }
    }
}

// ----------------------------------------------------------------
// Shortcuts via PowerShell WScript.Shell COM
// ----------------------------------------------------------------

fn ps_single_quote(s: &str) -> String {
    s.replace('\'', "''")
}

fn ps_double_quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            _ => out.push(c),
        }
    }
    out.push('"');
    out
}

fn create_shortcut(link_path: &Path, target_path: &Path, description: &str) -> std::io::Result<()> {
    if let Some(parent) = link_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let script = format!(
        "$shell = New-Object -ComObject WScript.Shell; \
         $shortcut = $shell.CreateShortcut({}); \
         $shortcut.TargetPath = {}; \
         $shortcut.WorkingDirectory = {}; \
         $shortcut.Description = {}; \
         $shortcut.IconLocation = {}; \
         $shortcut.Save()",
        ps_double_quote(&link_path.display().to_string()),
        ps_double_quote(&target_path.display().to_string()),
        ps_double_quote(
            &target_path
                .parent()
                .map(|p| p.display().to_string())
                .unwrap_or_default(),
        ),
        ps_double_quote(description),
        ps_double_quote(&format!("{},0", target_path.display())),
    );
    let status = cmd("powershell.exe")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &script])
        .status()?;
    if !status.success() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("powershell shortcut creation failed : exit {}", status),
        ));
    }
    Ok(())
}

// ----------------------------------------------------------------
// Uninstaller
// ----------------------------------------------------------------

fn write_uninstaller(install_dir: &Path) -> std::io::Result<PathBuf> {
    let script_path = install_dir.join("Uninstall LokLM.ps1");
    let safe_install_dir = ps_single_quote(&install_dir.display().to_string());
    let script = format!(
        r#"
$ErrorActionPreference = 'SilentlyContinue'
Remove-Item "$env:USERPROFILE\Desktop\LokLM.lnk" -Force
Remove-Item "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\LokLM.lnk" -Force
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "LokLM" /f | Out-Null
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\LokLM" /f | Out-Null
reg delete "HKCU\Software\LokLM" /f | Out-Null
$target = '{}'
Start-Process -WindowStyle Hidden -FilePath cmd.exe -ArgumentList '/c','timeout /t 1 > nul & rmdir /s /q',('"' + $target + '"')
"#,
        safe_install_dir
    );
    std::fs::write(&script_path, script.trim_start())?;
    Ok(script_path)
}

fn write_uninstall_registry(
    install_dir: &Path,
    app_exe_path: &Path,
    uninstaller_path: &Path,
    version: &str,
) -> std::io::Result<()> {
    reg_add(UNINSTALL_KEY, "DisplayName", "REG_SZ", PRODUCT_NAME)?;
    reg_add(UNINSTALL_KEY, "DisplayVersion", "REG_SZ", version)?;
    reg_add(UNINSTALL_KEY, "Publisher", "REG_SZ", "Projektgruppe LokLM")?;
    reg_add(
        UNINSTALL_KEY,
        "InstallLocation",
        "REG_SZ",
        &install_dir.display().to_string(),
    )?;
    reg_add(
        UNINSTALL_KEY,
        "DisplayIcon",
        "REG_SZ",
        &app_exe_path.display().to_string(),
    )?;
    reg_add(
        UNINSTALL_KEY,
        "UninstallString",
        "REG_SZ",
        &format!(
            r#"powershell.exe -NoProfile -ExecutionPolicy Bypass -File "{}""#,
            uninstaller_path.display()
        ),
    )?;
    reg_add(UNINSTALL_KEY, "NoModify", "REG_DWORD", "1")?;
    reg_add(UNINSTALL_KEY, "NoRepair", "REG_DWORD", "1")?;
    Ok(())
}

// ----------------------------------------------------------------
// Options : shortcuts + autostart
// ----------------------------------------------------------------

fn apply_options(options: &InstallOptions, app_exe_path: &Path) -> std::io::Result<()> {
    reg_add(
        SETUP_KEY,
        "DesktopShortcut",
        "REG_SZ",
        if options.create_desktop_shortcut { "1" } else { "0" },
    )?;
    reg_add(
        SETUP_KEY,
        "StartMenuShortcut",
        "REG_SZ",
        if options.create_start_menu_shortcut { "1" } else { "0" },
    )?;

    let home = std::env::var("USERPROFILE").unwrap_or_default();
    let desktop_link = PathBuf::from(&home).join("Desktop").join("LokLM.lnk");
    let appdata =
        std::env::var("APPDATA").unwrap_or_else(|_| format!("{}\\AppData\\Roaming", home));
    let start_menu_link = PathBuf::from(appdata)
        .join("Microsoft")
        .join("Windows")
        .join("Start Menu")
        .join("Programs")
        .join("LokLM.lnk");

    if options.create_desktop_shortcut {
        create_shortcut(&desktop_link, app_exe_path, "LokLM starten")?;
    } else {
        let _ = std::fs::remove_file(&desktop_link);
    }

    if options.create_start_menu_shortcut {
        create_shortcut(&start_menu_link, app_exe_path, "LokLM starten")?;
    } else {
        let _ = std::fs::remove_file(&start_menu_link);
    }

    if options.enable_autostart {
        reg_add(
            RUN_KEY,
            "LokLM",
            "REG_SZ",
            &format!(r#""{}""#, app_exe_path.display()),
        )?;
    } else {
        reg_delete_value(RUN_KEY, "LokLM");
    }
    Ok(())
}

// ----------------------------------------------------------------
// Robocopy : recursive copy of payload to install dir
// ----------------------------------------------------------------

fn robocopy_dir(source: &Path, dest: &Path) -> std::io::Result<()> {
    let robocopy = std::env::var("SystemRoot")
        .map(|sr| PathBuf::from(sr).join("System32").join("robocopy.exe"))
        .unwrap_or_else(|_| PathBuf::from("robocopy.exe"));
    // /MIR mirrors source→dest and PURGES anything in dest that's not in
    // source. The payload ( win-unpacked ) has no models/ dir , so on a
    // re-install /MIR would delete the GGUFs the previous install
    // downloaded — then the download phase re-fetches multi-GB files for
    // nothing. /XD excludes the models dir from the purge so existing
    // models survive and download_all's existing_complete() skip kicks in.
    // We also exclude the tier-marker so a re-install doesn't wipe it
    // before write_tier_marker rewrites it ( harmless either way , but
    // tidy ). loklm-tier.json sits at the install-dir root.
    let models_dir = dest.join("models");
    let out = cmd_path(robocopy)
        .args([
            source.to_str().unwrap_or_default(),
            dest.to_str().unwrap_or_default(),
            "/MIR",
            "/COPY:DAT",
            // Low retry budget : we already stop_running_app() before this ,
            // so a still-locked file is an anomaly we want to surface fast
            // rather than grind through ( /R:3 /W:2 was ~6s per locked file ,
            // looked frozen when the whole app was running ).
            "/R:1",
            "/W:1",
            "/XD",
            models_dir.to_str().unwrap_or_default(),
            "/XF",
            "loklm-tier.json",
            "/NJH",
            "/NJS",
            "/NDL",
            "/NFL",
            "/NC",
            "/NS",
            "/NP",
        ])
        .output()?;
    let code = out.status.code().unwrap_or(-1);
    if code < 0 || code >= 8 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("robocopy failed : exit {}", code),
        ));
    }
    Ok(())
}

// ----------------------------------------------------------------
// Stop a running LokLM before overwriting its files
// ----------------------------------------------------------------

// Force-terminate any running LokLM.exe ( the app being updated ) plus its
// electron child processes ( /T kills the tree ) so robocopy can overwrite
// the locked payload. Synchronous + best-effort : taskkill exits non-zero
// when no process matches , which we ignore. The short sleep gives Windows
// a beat to release the file handles before robocopy starts.
fn stop_running_app() {
    let taskkill = std::env::var("SystemRoot")
        .map(|sr| PathBuf::from(sr).join("System32").join("taskkill.exe"))
        .unwrap_or_else(|_| PathBuf::from("taskkill.exe"));
    let _ = cmd_path(taskkill)
        .args(["/IM", APP_EXE, "/T", "/F"])
        .status();
    std::thread::sleep(std::time::Duration::from_millis(700));
}

// ----------------------------------------------------------------
// Public API : install , get_state , get_license , launch
// ----------------------------------------------------------------

// Phase budgets in the overall progress bar :
//   prepare-folder + copy-files + apply-options + register-uninstaller : 0-40%
//   download-models                                                    : 40-95%
//   write-tier-marker + done                                           : 95-100%
//
// The download phase reports its OWN 0-100% via the per-model events ;
// we rescale into the 40-95 slot before emitting upstream.
pub async fn install<F>(
    options: &InstallOptions,
    version: &str,
    mut progress: F,
) -> Result<InstallResult, String>
where
    F: FnMut(ProgressEvent) + Send,
{
    let source = payload_dir()
        .ok_or("payload nicht gefunden — bitte zuerst den win-unpacked-build ausführen")?;
    let install_dir = if options.install_dir.is_empty() {
        default_install_dir()
    } else {
        PathBuf::from(&options.install_dir)
    };
    let app_exe_path = install_dir.join(APP_EXE);

    if !source.join(APP_EXE).exists() {
        return Err(format!("payload exe fehlt in {}", source.display()));
    }

    progress(ProgressEvent { step: "preparing-folder".into(), percent: 5 });
    // Re-install over a running app : LokLM.exe + its DLLs are locked , so
    // robocopy can't overwrite them and grinds through its retry budget
    // ( looks frozen on "copying files" ). Stop the app first. Best-effort —
    // taskkill returns non-zero when nothing's running , which is fine.
    stop_running_app();
    std::fs::create_dir_all(&install_dir).map_err(|e| format!("mkdir failed : {}", e))?;

    progress(ProgressEvent { step: "copying-files".into(), percent: 12 });
    robocopy_dir(&source, &install_dir).map_err(|e| e.to_string())?;

    progress(ProgressEvent { step: "applying-options".into(), percent: 30 });
    apply_options(options, &app_exe_path).map_err(|e| e.to_string())?;

    progress(ProgressEvent { step: "registering-uninstaller".into(), percent: 38 });
    let uninstaller_path = write_uninstaller(&install_dir).map_err(|e| e.to_string())?;
    write_uninstall_registry(&install_dir, &app_exe_path, &uninstaller_path, version)
        .map_err(|e| e.to_string())?;

    progress(ProgressEvent { step: "downloading-models".into(), percent: 40 });
    let downloaded = match super::download_all(&install_dir, options.tier, |ev| {
        // Scale 0-100 inner into the 40-95 outer slot.
        let scaled = 40 + (ev.percent as u64 * 55 / 100) as u32;
        progress(ProgressEvent { step: ev.step, percent: scaled });
    })
    .await
    {
        Ok(v) => v,
        Err(e) => {
            // T2.4 : on any download failure , clean up partials so the next
            // install attempt finds a consistent state. We do NOT delete
            // fully-downloaded models — those are reused via the idempotency
            // check on retry.
            let _ = super::cleanup_partials(&install_dir).await;
            return Err(e);
        }
    };

    progress(ProgressEvent { step: "writing-tier-marker".into(), percent: 97 });
    super::write_tier_marker(&install_dir, options, version, &downloaded)
        .map_err(|e| format!("tier-marker write failed : {}", e))?;

    progress(ProgressEvent { step: "done".into(), percent: 100 });

    Ok(InstallResult {
        install_dir: install_dir.display().to_string(),
        app_exe_path: app_exe_path.display().to_string(),
    })
}

pub fn get_state() -> InstallerState {
    let payload_ready = payload_dir().is_some();
    InstallerState {
        default_install_dir: suggested_install_dir().display().to_string(),
        existing_install_dir: existing_install_dir().map(|p| p.display().to_string()),
        payload_ready,
    }
}

pub fn get_license() -> Option<String> {
    let path = license_file_path()?;
    std::fs::read_to_string(path).ok()
}

pub fn launch(app_exe_path: &str) -> Result<(), String> {
    // De-elevation trick : launch through explorer.exe instead of
    // CreateProcess. If the wizard happens to be elevated ( Windows
    // AppCompat sometimes auto-elevates binaries with "setup" or
    // "installer" in the name regardless of our asInvoker manifest ) ,
    // a direct spawn would hand the elevated token to LokLM.exe and
    // the user ends up with the chat app running as Administrator
    // forever. explorer.exe runs under the user's regular shell token ,
    // so it acts as a trampoline that drops elevation cleanly.
    //
    // Also why we don't use `cmd /c start` : that uses ShellExecuteEx
    // which inherits the parent's token. explorer.exe's ShellExecute
    // dispatch resolves through the user's shell , not the wizard
    // process , and the resulting child runs un-elevated.
    let explorer = std::env::var("SystemRoot")
        .map(|sr| PathBuf::from(sr).join("explorer.exe"))
        .unwrap_or_else(|_| PathBuf::from("explorer.exe"));
    cmd_path(explorer)
        .arg(app_exe_path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
