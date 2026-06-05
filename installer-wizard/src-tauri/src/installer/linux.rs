// Linux install backend : XDG-conformant paths , .desktop files for
// shortcuts + autostart , JSON manifest for the uninstaller. No reg.exe ,
// no PowerShell , no robocopy — everything goes through std::fs and
// shelling out to `cp -r` for the recursive payload copy.
//
// Layout produced :
//   $XDG_DATA_HOME/loklm/                          ← LokLM payload + .desktop sources
//   ~/.local/share/applications/loklm.desktop      ← "start menu" entry
//   ~/Desktop/loklm.desktop                        ← desktop shortcut ( if enabled )
//   ~/.config/autostart/loklm.desktop              ← autostart ( if enabled )
//   ~/.config/loklm/install-manifest.json          ← uninstall reads this
//   $XDG_DATA_HOME/loklm/uninstall.sh              ← user-runnable removal script

#![cfg(target_os = "linux")]

use super::{InstallOptions, InstallResult, InstallerState, ProgressEvent};
use std::path::{Path, PathBuf};
use std::process::Command;

const APP_BIN: &str = "loklm"; // electron-builder lowercases productName on linux

// ----------------------------------------------------------------
// XDG paths
// ----------------------------------------------------------------

fn home_dir() -> PathBuf {
    std::env::var("HOME").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("/tmp"))
}

fn xdg_data_home() -> PathBuf {
    std::env::var("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| home_dir().join(".local").join("share"))
}

fn xdg_config_home() -> PathBuf {
    std::env::var("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| home_dir().join(".config"))
}

fn applications_dir() -> PathBuf {
    xdg_data_home().join("applications")
}

fn autostart_dir() -> PathBuf {
    xdg_config_home().join("autostart")
}

fn desktop_dir() -> PathBuf {
    // xdg-user-dirs would resolve this properly ; for simplicity we
    // assume the typical ~/Desktop. If the user moved their desktop dir
    // they likely don't want a shortcut there anyway.
    home_dir().join("Desktop")
}

fn config_dir() -> PathBuf {
    xdg_config_home().join("loklm")
}

fn default_install_dir() -> PathBuf {
    xdg_data_home().join("loklm")
}

fn manifest_path() -> PathBuf {
    config_dir().join("install-manifest.json")
}

// Where the download-stub wizard puts the downloaded payload + cuda
// archives while it's working. install() extracts both into here ; then
// cp -a mirrors from staging/linux-unpacked/ into the user-chosen
// install dir ; the staging tree is best-effort-cleaned at the end.
fn staging_dir() -> PathBuf {
    let tmp = std::env::var("TMPDIR")
        .ok()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp"));
    tmp.join("loklm-setup").join("staging")
}

// Locate the LokLM payload ( linux-unpacked dir ). Three layouts , in order :
//   1. Bundled : ../linux-unpacked relative to the wizard binary. The
//      makeself stub extracts the payload as a sibling of installer/
//      ( <extract>/installer/loklm + <extract>/linux-unpacked ). This is
//      the production layout for the self-contained installer.
//   2. Staging : $TMPDIR/loklm-setup/staging/linux-unpacked/ , populated
//      by install()'s download-payload fallback ( legacy download-stub ).
//   3. Dev : ../../../../release/linux-unpacked relative to this binary ,
//      for running the wizard out of cargo target against a local payload
//      build ( pnpm package:linux:payload ).
fn payload_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok();

    if let Some(exe_dir) = exe.as_ref().and_then(|e| e.parent()) {
        let bundled = exe_dir.join("..").join("linux-unpacked");
        if bundled.join(APP_BIN).exists() {
            return Some(bundled);
        }
    }

    let staged = staging_dir().join("linux-unpacked");
    if staged.join(APP_BIN).exists() {
        return Some(staged);
    }

    let exe = exe?;
    let exe_dir = exe.parent()?;
    let dev = exe_dir
        .join("..")
        .join("..")
        .join("..")
        .join("..")
        .join("release")
        .join("linux-unpacked");
    if dev.join(APP_BIN).exists() {
        return Some(dev);
    }
    None
}

fn license_file_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let exe_dir = exe.parent()?;
    let alongside = exe_dir.join("LICENSE");
    if alongside.exists() {
        return Some(alongside);
    }
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
// Existing install detection
// ----------------------------------------------------------------

fn existing_install_dir() -> Option<PathBuf> {
    // Check the manifest first ( the source of truth after install ) ,
    // then fall back to the default dir in case the manifest was wiped
    // but the files survived.
    if let Ok(text) = std::fs::read_to_string(manifest_path()) {
        if let Some(line) = text
            .lines()
            .find(|l| l.contains("\"install_dir\""))
            .and_then(|l| l.split(':').nth(1))
        {
            let path = line.trim().trim_matches(|c| c == '"' || c == ',').to_string();
            let p = PathBuf::from(path);
            if p.join(APP_BIN).exists() {
                return Some(p);
            }
        }
    }
    let d = default_install_dir();
    if d.join(APP_BIN).exists() { Some(d) } else { None }
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
            _ => return home_dir(),
        }
    }
}

// ----------------------------------------------------------------
// .desktop file generation
// ----------------------------------------------------------------

fn write_desktop_file(
    path: &Path,
    name: &str,
    comment: &str,
    exec: &Path,
    icon: Option<&Path>,
    categories: &str,
) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let icon_line = match icon {
        Some(p) => format!("Icon={}\n", p.display()),
        None => String::new(),
    };
    let body = format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name={name}\n\
         Comment={comment}\n\
         Exec={exec}\n\
         {icon_line}\
         Terminal=false\n\
         Categories={categories}\n\
         StartupNotify=true\n",
        name = name,
        comment = comment,
        exec = exec.display(),
        icon_line = icon_line,
        categories = categories,
    );
    std::fs::write(path, body)?;
    // .desktop files on the Desktop must be executable to launch on
    // double-click ( gnome-shell + KDE both require this ).
    use std::os::unix::fs::PermissionsExt;
    let mut perms = std::fs::metadata(path)?.permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(path, perms)?;
    Ok(())
}

// ----------------------------------------------------------------
// Uninstaller script + manifest
// ----------------------------------------------------------------

fn write_uninstaller(install_dir: &Path) -> std::io::Result<PathBuf> {
    let script_path = install_dir.join("uninstall.sh");
    let body = format!(
        "#!/usr/bin/env bash\n\
         # LokLM uninstaller — removes shortcuts + autostart + install dir.\n\
         set -e\n\
         rm -f '{desktop_app}'\n\
         rm -f '{desktop_link}'\n\
         rm -f '{autostart}'\n\
         rm -rf '{config}'\n\
         rm -rf '{install_dir}'\n",
        desktop_app = applications_dir().join("loklm.desktop").display(),
        desktop_link = desktop_dir().join("loklm.desktop").display(),
        autostart = autostart_dir().join("loklm.desktop").display(),
        config = config_dir().display(),
        install_dir = install_dir.display(),
    );
    std::fs::write(&script_path, body)?;
    use std::os::unix::fs::PermissionsExt;
    let mut perms = std::fs::metadata(&script_path)?.permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(&script_path, perms)?;
    Ok(script_path)
}

fn write_manifest(install_dir: &Path, version: &str) -> std::io::Result<()> {
    let path = manifest_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let body = format!(
        "{{\n  \"version\": \"{version}\",\n  \"install_dir\": \"{install_dir}\"\n}}\n",
        version = version,
        install_dir = install_dir.display(),
    );
    std::fs::write(&path, body)
}

// ----------------------------------------------------------------
// Options : shortcuts + autostart
// ----------------------------------------------------------------

fn apply_options(options: &InstallOptions, install_dir: &Path) -> std::io::Result<()> {
    let app_exe = install_dir.join(APP_BIN);
    let icon = install_dir.join("resources").join("icon.png");
    let icon_opt = if icon.exists() { Some(icon.as_path()) } else { None };

    // App menu entry — counterpart to Windows' start-menu shortcut.
    let menu_entry = applications_dir().join("loklm.desktop");
    if options.create_start_menu_shortcut {
        write_desktop_file(
            &menu_entry,
            "LokLM",
            "Lokaler KI-Wissensassistent",
            &app_exe,
            icon_opt,
            "Office;Utility;",
        )?;
    } else {
        let _ = std::fs::remove_file(&menu_entry);
    }

    // Desktop shortcut.
    let desktop_link = desktop_dir().join("loklm.desktop");
    if options.create_desktop_shortcut {
        write_desktop_file(
            &desktop_link,
            "LokLM",
            "Lokaler KI-Wissensassistent",
            &app_exe,
            icon_opt,
            "Office;Utility;",
        )?;
    } else {
        let _ = std::fs::remove_file(&desktop_link);
    }

    // Autostart entry.
    let autostart_entry = autostart_dir().join("loklm.desktop");
    if options.enable_autostart {
        write_desktop_file(
            &autostart_entry,
            "LokLM",
            "Lokaler KI-Wissensassistent ( Autostart )",
            &app_exe,
            icon_opt,
            "Office;Utility;",
        )?;
    } else {
        let _ = std::fs::remove_file(&autostart_entry);
    }

    Ok(())
}

// ----------------------------------------------------------------
// Recursive payload copy via `cp -r`
// ----------------------------------------------------------------

fn copy_dir(source: &Path, dest: &Path) -> std::io::Result<()> {
    // Wipe stale payload files from any previous install , but PRESERVE the
    // models/ dir ( multi-GB GGUFs the previous install downloaded ) and the
    // loklm-tier.json marker. A blind remove_dir_all(dest) would nuke the
    // models , then download_all re-fetches them for nothing — and the
    // existing_complete() skip never gets a chance to fire.
    if dest.exists() {
        for entry in std::fs::read_dir(dest)? {
            let entry = entry?;
            let name = entry.file_name();
            if name == "models" || name == "loklm-tier.json" {
                continue;
            }
            let path = entry.path();
            if path.is_dir() {
                std::fs::remove_dir_all(&path)?;
            } else {
                std::fs::remove_file(&path)?;
            }
        }
    }
    std::fs::create_dir_all(dest)?;
    // `cp -r source/. dest/` copies *contents* into dest ; without the
    // trailing /. it would create dest/source/.
    let src_arg = format!("{}/.", source.display());
    let status = Command::new("cp")
        .args(["-a", &src_arg, &dest.display().to_string()])
        .status()?;
    if !status.success() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("cp -a failed : exit {}", status),
        ));
    }
    // Make sure the main binary stays executable ( -a preserves the
    // mode but only if the source had it ; double-check just in case ).
    use std::os::unix::fs::PermissionsExt;
    let app_exe = dest.join(APP_BIN);
    if app_exe.exists() {
        let mut perms = std::fs::metadata(&app_exe)?.permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&app_exe, perms)?;
    }
    Ok(())
}

// ----------------------------------------------------------------
// Public API
// ----------------------------------------------------------------

// Phase budget : 0-30 download , 30-62 setup ( prep / copy / options /
// uninstaller ) , 62-97 model download , 97-100 marker.
pub async fn install<F>(
    options: &InstallOptions,
    version: &str,
    mut progress: F,
) -> Result<InstallResult, String>
where
    F: FnMut(ProgressEvent) + Send,
{
    use super::{archive, download, payload_manifest};

    let bundle = payload_manifest::current_bundle();

    // If a payload is already on disk ( embedded into the installer , or a
    // local dev build ) , skip the network download and install straight
    // from it. Only the legacy download-stub layout falls through to the CDN.
    let preexisting_payload = payload_dir();

    // ---- Phase 0 : free-space precheck -----------------------------------
    // A bundled payload is already extracted , so it doesn't count toward
    // the budget ; only the ( optional ) CUDA archive does.
    let needed = (if preexisting_payload.is_none() {
        bundle.payload.size_bytes
    } else {
        0
    }) + if options.download_cuda {
        bundle.cuda.as_ref().map(|c| c.size_bytes).unwrap_or(0)
    } else {
        0
    };
    let needed_with_headroom = needed + needed / 5;
    let staging = staging_dir();
    std::fs::create_dir_all(&staging).map_err(|e| format!("mkdir staging : {}", e))?;
    {
        use sysinfo::Disks;
        let disks = Disks::new_with_refreshed_list();
        let staging_canon = std::fs::canonicalize(&staging).unwrap_or_else(|_| staging.clone());
        let best = disks
            .iter()
            .filter(|d| staging_canon.starts_with(d.mount_point()))
            .max_by_key(|d| d.mount_point().as_os_str().len());
        if let Some(d) = best {
            if d.available_space() < needed_with_headroom {
                return Err(format!(
                    "Mindestens {} GB freier Speicher in {} erforderlich ( verfügbar : {} GB ).",
                    (needed_with_headroom + 1024 * 1024 * 1024 - 1) / (1024 * 1024 * 1024),
                    staging.display(),
                    d.available_space() / (1024 * 1024 * 1024),
                ));
            }
        }
    }

    let client = download::build_client();

    // ---- Phase 1 : payload ( bundled → no-op ; else download 0-15 % ) ----
    if preexisting_payload.is_none() {
        progress(ProgressEvent { step: "download-payload".into(), percent: 0 });
        let payload_archive_path = staging.join(&bundle.payload.filename);
        download::download_with_resume(
            &client,
            download::DownloadSpec {
                url: &payload_manifest::payload_url(),
                dest: &payload_archive_path,
                expected_sha256: Some(&bundle.payload.sha256),
                expected_size: Some(bundle.payload.size_bytes),
            },
            |written, total| {
                let pct = ((written.saturating_mul(15)) / total.max(1)) as u32;
                progress(ProgressEvent {
                    step: "download-payload".into(),
                    percent: pct.min(15),
                });
            },
        )
        .await
        .map_err(|e| format!("payload download : {}", e))?;
        archive::extract_tar_zst(&payload_archive_path, &staging)
            .map_err(|e| format!("payload extract : {}", e))?;
        let _ = std::fs::remove_file(&payload_archive_path);
    }

    // ---- Phase 2 : optional CUDA addon ( 15-30 % ) -----------------------
    if options.download_cuda {
        if let Some(cuda_entry) = bundle.cuda.as_ref() {
            let cuda_url = payload_manifest::cuda_url()
                .expect("manifest has cuda entry on this platform");
            let cuda_archive_path = staging.join(&cuda_entry.filename);
            progress(ProgressEvent { step: "download-cuda".into(), percent: 15 });
            download::download_with_resume(
                &client,
                download::DownloadSpec {
                    url: &cuda_url,
                    dest: &cuda_archive_path,
                    expected_sha256: Some(&cuda_entry.sha256),
                    expected_size: Some(cuda_entry.size_bytes),
                },
                |written, total| {
                    let pct = 15 + ((written.saturating_mul(15)) / total.max(1)) as u32;
                    progress(ProgressEvent {
                        step: "download-cuda".into(),
                        percent: pct.min(30),
                    });
                },
            )
            .await
            .map_err(|e| format!("cuda download : {}", e))?;
            archive::extract_tar_zst(&cuda_archive_path, &staging)
                .map_err(|e| format!("cuda extract : {}", e))?;
            let _ = std::fs::remove_file(&cuda_archive_path);
        }
    }

    // ---- Phase 3+ : the existing install flow ----------------------------
    let source = payload_dir()
        .ok_or("payload nicht gefunden nach Download — staging layout korrupt ?")?;
    let install_dir = if options.install_dir.is_empty() {
        default_install_dir()
    } else {
        PathBuf::from(&options.install_dir)
    };
    let app_exe_path = install_dir.join(APP_BIN);

    if !source.join(APP_BIN).exists() {
        return Err(format!("payload binary fehlt in {}", source.display()));
    }

    progress(ProgressEvent { step: "preparing-folder".into(), percent: 30 });
    std::fs::create_dir_all(&install_dir).map_err(|e| format!("mkdir failed : {}", e))?;

    progress(ProgressEvent { step: "copying-files".into(), percent: 32 });
    copy_dir(&source, &install_dir).map_err(|e| e.to_string())?;

    progress(ProgressEvent { step: "applying-options".into(), percent: 55 });
    apply_options(options, &install_dir).map_err(|e| e.to_string())?;

    progress(ProgressEvent { step: "registering-uninstaller".into(), percent: 60 });
    write_uninstaller(&install_dir).map_err(|e| e.to_string())?;
    write_manifest(&install_dir, version).map_err(|e| e.to_string())?;

    progress(ProgressEvent { step: "downloading-models".into(), percent: 62 });
    let downloaded = match super::download_all(&install_dir, options.tier, |ev| {
        let scaled = 62 + (ev.percent as u64 * 35 / 100) as u32;
        progress(ProgressEvent { step: ev.step, percent: scaled });
    })
    .await
    {
        Ok(v) => v,
        Err(e) => {
            let _ = super::cleanup_partials(&install_dir).await;
            return Err(e);
        }
    };

    progress(ProgressEvent { step: "writing-tier-marker".into(), percent: 97 });
    super::write_tier_marker(&install_dir, options, version, &downloaded)
        .map_err(|e| format!("tier-marker write failed : {}", e))?;

    progress(ProgressEvent { step: "done".into(), percent: 100 });

    let _ = std::fs::remove_dir_all(staging.parent().unwrap_or(&staging));

    Ok(InstallResult {
        install_dir: install_dir.display().to_string(),
        app_exe_path: app_exe_path.display().to_string(),
    })
}

pub fn get_state() -> InstallerState {
    // Download-stub model : payload arrives at install time , not pre-staged.
    // Always report ready so the renderer's old "payload missing" guard
    // ( meaningful for the embedded-payload makeself layout ) doesn't fire.
    InstallerState {
        default_install_dir: suggested_install_dir().display().to_string(),
        existing_install_dir: existing_install_dir().map(|p| p.display().to_string()),
        payload_ready: true,
    }
}

pub fn get_license() -> Option<String> {
    let path = license_file_path()?;
    std::fs::read_to_string(path).ok()
}

pub fn launch(app_exe_path: &str) -> Result<(), String> {
    // Spawn detached so the wizard can exit cleanly after launching the
    // app ; without setsid the kernel attaches the child to the wizard
    // process group and our exit takes it down with us.
    Command::new("setsid")
        .args(["--fork", app_exe_path])
        .spawn()
        .or_else(|_| {
            // setsid may not be installed on minimal distros ; fall back
            // to plain spawn ( detached enough for desktop launches ).
            Command::new(app_exe_path).spawn()
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}
