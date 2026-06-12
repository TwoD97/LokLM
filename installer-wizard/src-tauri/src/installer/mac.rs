// macOS install backend for the download-stub wizard.
//
// Layout produced :
//   /Applications/LokLM.app                                      ← payload
//   ~/Library/Application Support/LokLM/                         ← models , tier-marker
//   ~/Library/LaunchAgents/com.loklm.desktop.plist               ← autostart ( opt-in )
//   /Applications/LokLM.app/Contents/Resources/uninstall.sh      ← user-runnable removal
//
// Why the install dir is /Applications/LokLM.app and not under ~/Library :
//   Mac users expect double-clickable .app bundles in /Applications ;
//   Launchpad + Spotlight + the Dock all index there by default. ~/Library
//   is for runtime data ( models , preferences ) that doesn't need to be
//   visible in Finder.

#![cfg(target_os = "macos")]

use super::{archive, download, payload_manifest};
use super::{InstallOptions, InstallResult, InstallerState, ProgressEvent};
use std::path::{Path, PathBuf};
use std::process::Command;

const APP_BUNDLE: &str = "LokLM.app";
const APP_BIN: &str = "LokLM";
const BUNDLE_ID: &str = "com.loklm.desktop";

// ----------------------------------------------------------------
// Paths
// ----------------------------------------------------------------

fn home_dir() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/tmp"))
}

fn applications_dir() -> PathBuf {
    PathBuf::from("/Applications")
}

fn default_install_dir() -> PathBuf {
    applications_dir()
}

fn launch_agents_dir() -> PathBuf {
    home_dir().join("Library").join("LaunchAgents")
}

fn app_support_dir() -> PathBuf {
    home_dir()
        .join("Library")
        .join("Application Support")
        .join("LokLM")
}

fn staging_dir() -> PathBuf {
    let tmp = std::env::var("TMPDIR")
        .ok()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp"));
    tmp.join("loklm-setup").join("staging")
}

// Locate the LokLM.app payload. Two layouts , in order :
//   1. Staging : $TMPDIR/loklm-setup/staging/LokLM.app , populated by
//      install()'s download-payload phase. Production layout.
//   2. Dev : ../../../../release/mac/LokLM.app relative to this binary ,
//      for running the wizard out of cargo target against a local payload
//      build ( pnpm package:mac:payload ).
fn payload_dir() -> Option<PathBuf> {
    let staged = staging_dir().join(APP_BUNDLE);
    if staged.join("Contents/MacOS").join(APP_BIN).exists() {
        return Some(staged);
    }
    let exe = std::env::current_exe().ok()?;
    let exe_dir = exe.parent()?;
    let dev = exe_dir
        .join("..")
        .join("..")
        .join("..")
        .join("..")
        .join("release")
        .join("mac")
        .join(APP_BUNDLE);
    if dev.join("Contents/MacOS").join(APP_BIN).exists() {
        return Some(dev);
    }
    None
}

fn license_file_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let exe_dir = exe.parent()?;
    // Inside the wizard .app bundle , Resources is the conventional location.
    for candidate in [
        exe_dir.join("LICENSE"),
        exe_dir.join("..").join("Resources").join("LICENSE"),
    ] {
        if candidate.exists() {
            return Some(candidate);
        }
    }
    // Dev fallback : cargo target -> repo LICENSE.
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

fn existing_install_dir() -> Option<PathBuf> {
    let candidate = applications_dir().join(APP_BUNDLE);
    if candidate.join("Contents/MacOS").join(APP_BIN).exists() {
        Some(candidate)
    } else {
        None
    }
}

fn suggested_install_dir() -> PathBuf {
    existing_install_dir().unwrap_or_else(default_install_dir)
}

pub fn dialog_default_path(current: Option<&str>) -> PathBuf {
    current
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(default_install_dir)
}

// ----------------------------------------------------------------
// Bundle copy via `ditto`
// ----------------------------------------------------------------

// Apple's recommended bundle-copy tool. Preserves resource forks ,
// extended attributes ( important for signed bundles ) , and the
// HFS+/APFS-specific metadata cp can drop. Replaces the destination
// when it exists.
fn ditto(source: &Path, dest: &Path) -> std::io::Result<()> {
    let out = Command::new("/usr/bin/ditto")
        .args([
            source.to_str().unwrap_or_default(),
            dest.to_str().unwrap_or_default(),
        ])
        .output()?;
    if !out.status.success() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!(
                "ditto failed : exit {} , stderr {}",
                out.status,
                String::from_utf8_lossy(&out.stderr)
            ),
        ));
    }
    Ok(())
}

// ----------------------------------------------------------------
// LaunchAgent ( autostart )
// ----------------------------------------------------------------

fn launch_agent_path() -> PathBuf {
    launch_agents_dir().join(format!("{}.plist", BUNDLE_ID))
}

fn write_launch_agent(app_bin_path: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(launch_agents_dir())?;
    // Minimal LaunchAgent : run the app at user login. RunAtLoad=true plus
    // ProcessType=Interactive keeps the bundle in the user's regular GUI
    // session rather than a headless daemon context.
    let plist = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{}</string>
  <key>ProgramArguments</key><array><string>{}</string></array>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Interactive</string>
</dict>
</plist>
"#,
        BUNDLE_ID,
        app_bin_path.display(),
    );
    std::fs::write(launch_agent_path(), plist)
}

fn remove_launch_agent() {
    let _ = std::fs::remove_file(launch_agent_path());
}

// ----------------------------------------------------------------
// Uninstaller script
// ----------------------------------------------------------------

fn write_uninstaller(install_dir: &Path) -> std::io::Result<PathBuf> {
    let res = install_dir.join("Contents").join("Resources");
    std::fs::create_dir_all(&res)?;
    let script_path = res.join("uninstall.sh");
    let script = format!(
        "#!/usr/bin/env bash\n\
         # LokLM uninstaller — removes /Applications/LokLM.app , the LaunchAgent ,\n\
         # and ~/Library/Application Support/LokLM ( models + tier marker ).\n\
         set -e\n\
         rm -rf '{install}'\n\
         rm -f '{launch_agent}'\n\
         rm -rf '{app_support}'\n",
        install = install_dir.display(),
        launch_agent = launch_agent_path().display(),
        app_support = app_support_dir().display(),
    );
    std::fs::write(&script_path, script)?;
    use std::os::unix::fs::PermissionsExt;
    let mut perms = std::fs::metadata(&script_path)?.permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(&script_path, perms)?;
    Ok(script_path)
}

// ----------------------------------------------------------------
// Options
// ----------------------------------------------------------------

fn apply_options(options: &InstallOptions, app_bin_path: &Path) -> std::io::Result<()> {
    // Mac equivalents :
    //   create_desktop_shortcut   : no-op ( drop in Dock is user-driven on mac )
    //   create_start_menu_shortcut: no-op ( /Applications IS the start menu ;
    //                                       once the .app is there Launchpad
    //                                       picks it up automatically )
    //   enable_autostart          : ~/Library/LaunchAgents plist
    let _ = options.create_desktop_shortcut;
    let _ = options.create_start_menu_shortcut;
    if options.enable_autostart {
        write_launch_agent(app_bin_path)?;
    } else {
        remove_launch_agent();
    }
    Ok(())
}

// ----------------------------------------------------------------
// Stop running app
// ----------------------------------------------------------------

fn stop_running_app() {
    // pkill -f matches the full command line ; the .app launcher and any
    // electron child processes all contain "LokLM.app" in their argv[0].
    // Best-effort ; non-zero exit means nothing was running , which is fine.
    let _ = Command::new("/usr/bin/pkill")
        .args(["-f", APP_BUNDLE])
        .status();
    std::thread::sleep(std::time::Duration::from_millis(500));
}

// ----------------------------------------------------------------
// Public API
// ----------------------------------------------------------------

pub async fn install<F>(
    options: &InstallOptions,
    version: &str,
    mut progress: F,
) -> Result<InstallResult, String>
where
    F: FnMut(ProgressEvent) + Send,
{
    let bundle = payload_manifest::current_bundle();
    // Mac has no `cuda` entry in the manifest ( downloads.rs ignores the
    // option ) , so the precheck is just the payload size. We factor in
    // the option for parity with the other platforms — value is 0 on mac.
    let needed = bundle.payload.size_bytes;
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

    progress(ProgressEvent { step: "download-payload".into(), percent: 0 });
    let client = download::build_client();
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

    // The archive builder historically packed every file with mode 0o644,
    // stripping the execute bit from all binaries.  Use `find` to locate
    // every MacOS/ directory inside the bundle so that the main binary AND
    // all Electron helper executables (Contents/Frameworks/*/Contents/MacOS/)
    // get +x — otherwise the browser process CHECKs when posix_spawnp fails
    // with EACCES trying to launch the GPU / Renderer helpers.
    let bundle_staging = staging.join(APP_BUNDLE);
    if bundle_staging.exists() {
        let _ = Command::new("/usr/bin/find")
            .args([
                bundle_staging.to_str().unwrap_or_default(),
                "-name",
                "MacOS",
                "-type",
                "d",
                "-exec",
                "/bin/chmod",
                "-R",
                "+x",
                "{}",
                ";",
            ])
            .output();
    }

    // No CUDA branch on mac : payload-manifest.json deliberately omits the
    // `cuda` key for mac-arm64 and mac-x64 ( see payload_manifest.rs ) ,
    // and the renderer hides the checkbox. If options.download_cuda
    // somehow arrives true we silently ignore it — no panic.
    let _ = options.download_cuda;

    let source = payload_dir()
        .ok_or("payload nicht gefunden nach Download — staging layout korrupt ?")?;
    let install_dir = if options.install_dir.is_empty() {
        default_install_dir().join(APP_BUNDLE)
    } else {
        let raw = PathBuf::from(&options.install_dir);
        // Honor both /Applications and /Applications/LokLM.app for the
        // user-supplied path : if they picked the parent , append the bundle.
        if raw.file_name().map(|n| n == APP_BUNDLE).unwrap_or(false) {
            raw
        } else {
            raw.join(APP_BUNDLE)
        }
    };
    let app_bin_path = install_dir.join("Contents").join("MacOS").join(APP_BIN);

    if !source.join("Contents/MacOS").join(APP_BIN).exists() {
        return Err(format!("payload binary fehlt in {}", source.display()));
    }

    progress(ProgressEvent { step: "preparing-folder".into(), percent: 30 });
    stop_running_app();
    if install_dir.exists() {
        std::fs::remove_dir_all(&install_dir)
            .map_err(|e| format!("rm old install : {}", e))?;
    }
    if let Some(parent) = install_dir.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir install parent : {}", e))?;
    }

    progress(ProgressEvent { step: "copying-files".into(), percent: 32 });
    ditto(&source, &install_dir).map_err(|e| e.to_string())?;

    // Ad-hoc sign with explicit JIT entitlement so V8 can map executable pages.
    // Signing WITHOUT --entitlements would strip allow-jit; signing WITH it
    // adds the entitlement even if the CI build was completely unsigned.
    // Non-fatal: if codesign fails we fall through and hope the build already
    // carried the entitlement.
    let ent_path = staging.join("loklm-entitlements.plist");
    let _ = std::fs::write(
        &ent_path,
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-jit</key><true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
    <key>com.apple.security.cs.disable-library-validation</key><true/>
</dict>
</plist>"#,
    );
    let _ = Command::new("/usr/bin/codesign")
        .args([
            "--force",
            "--deep",
            "--sign",
            "-",
            "--entitlements",
            ent_path.to_str().unwrap_or_default(),
            install_dir.to_str().unwrap_or_default(),
        ])
        .output();
    let _ = std::fs::remove_file(&ent_path);

    // Strip quarantine xattr so Gatekeeper doesn't block the app.
    let _ = Command::new("/usr/bin/xattr")
        .args(["-d", "com.apple.quarantine", &install_dir.display().to_string()])
        .output();

    progress(ProgressEvent { step: "applying-options".into(), percent: 55 });
    apply_options(options, &app_bin_path).map_err(|e| e.to_string())?;

    progress(ProgressEvent { step: "registering-uninstaller".into(), percent: 60 });
    let _ = write_uninstaller(&install_dir).map_err(|e| e.to_string())?;

    // Models + tier marker live under ~/Library/Application Support/LokLM
    // ( the app reads them from there ; same XDG-ish split as linux ).
    progress(ProgressEvent { step: "downloading-models".into(), percent: 62 });
    let app_support = app_support_dir();
    std::fs::create_dir_all(&app_support)
        .map_err(|e| format!("mkdir app-support : {}", e))?;
    let downloaded = match super::download_all(&app_support, options.tier, |ev| {
        let scaled = 62 + (ev.percent as u64 * 35 / 100) as u32;
        progress(ProgressEvent { step: ev.step, percent: scaled });
    })
    .await
    {
        Ok(v) => v,
        Err(e) => {
            let _ = super::cleanup_partials(&app_support).await;
            return Err(e);
        }
    };

    progress(ProgressEvent { step: "writing-tier-marker".into(), percent: 97 });
    super::write_tier_marker(&app_support, options, version, &downloaded)
        .map_err(|e| format!("tier-marker write failed : {}", e))?;

    progress(ProgressEvent { step: "done".into(), percent: 100 });

    let _ = std::fs::remove_dir_all(staging.parent().unwrap_or(&staging));

    Ok(InstallResult {
        install_dir: install_dir.display().to_string(),
        // Pass the .app bundle path, not the binary. `open <binary>` makes
        // macOS treat it as a document and opens it in TextEdit.
        app_exe_path: install_dir.display().to_string(),
    })
}

pub fn get_state() -> InstallerState {
    // Download-stub model : same posture as windows + linux. payload_ready
    // is hardcoded true because the payload arrives at install time.
    InstallerState {
        default_install_dir: default_install_dir().display().to_string(),
        existing_install_dir: existing_install_dir().map(|p| p.display().to_string()),
        payload_ready: true,
    }
}

pub fn get_license() -> Option<String> {
    let path = license_file_path()?;
    std::fs::read_to_string(path).ok()
}

pub fn launch(app_exe_path: &str) -> Result<(), String> {
    // -W : wait for the app to finish launching so we capture its exit code.
    // -n : always open a new instance even if one is already running.
    let out = Command::new("/usr/bin/open")
        .args(["-n", app_exe_path])
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let stdout = String::from_utf8_lossy(&out.stdout);
        Err(format!(
            "open exited {}: {} {}",
            out.status,
            stderr.trim(),
            stdout.trim()
        ))
    }
}
