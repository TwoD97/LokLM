//! Native copying into the transaction's private staging directory. In particular,
//! Windows canonical paths (including extended-length paths) never cross a CLI.

use std::fs;
use std::io;
use std::path::Path;

const CUDA_PACKAGES: &str = "resources/app.asar.unpacked/node_modules/@node-llama-cpp";
const CUDA_VARIANTS: [&str; 2] = ["win-x64-cuda", "win-x64-cuda-ext"];

fn context(action: &str, path: &Path, error: io::Error) -> io::Error {
    io::Error::new(
        error.kind(),
        format!("{action} '{}': {error}", path.display()),
    )
}

fn metadata(path: &Path) -> io::Result<fs::Metadata> {
    let meta = fs::symlink_metadata(path).map_err(|e| context("Cannot inspect", path, e))?;
    let linked = meta.file_type().is_symlink();
    #[cfg(windows)]
    let linked = {
        use std::os::windows::fs::MetadataExt;
        // Reject junctions and other reparse points as well as symbolic links.
        linked || meta.file_attributes() & 0x400 != 0
    };
    if linked {
        return Err(io::Error::other(format!(
            "Payload paths must not be links or reparse points: '{}'",
            path.display()
        )));
    }
    Ok(meta)
}

fn directory(path: &Path) -> io::Result<()> {
    if !metadata(path)?.is_dir() {
        return Err(io::Error::other(format!(
            "Expected a directory: '{}'",
            path.display()
        )));
    }
    Ok(())
}

fn ensure_directory(path: &Path) -> io::Result<()> {
    match fs::create_dir(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => directory(path),
        Err(e) => Err(context("Cannot create directory", path, e)),
    }
}

fn canonical(path: &Path) -> io::Result<std::path::PathBuf> {
    directory(path)?;
    fs::canonicalize(path).map_err(|e| context("Cannot resolve directory", path, e))
}

fn separate(source: &Path, destination: &Path) -> io::Result<()> {
    if source.starts_with(destination) || destination.starts_with(source) {
        return Err(io::Error::other(format!(
            "Payload source '{}' and staging directory '{}' must not overlap",
            source.display(),
            destination.display()
        )));
    }
    Ok(())
}

fn copy_tree(source: &Path, destination: &Path, payload_root: bool) -> io::Result<()> {
    directory(source)?;
    ensure_directory(destination)?;
    for entry in fs::read_dir(source).map_err(|e| context("Cannot list directory", source, e))? {
        let entry = entry.map_err(|e| context("Cannot read directory entry", source, e))?;
        let name = entry.file_name();
        // These belong to the installation, not to the application payload.
        // Nested resources/models directories are ordinary application assets.
        if payload_root
            && name.to_str().is_some_and(|name| {
                name.eq_ignore_ascii_case("models") || name.eq_ignore_ascii_case("loklm-tier.json")
            })
        {
            continue;
        }
        let from = entry.path();
        let to = destination.join(name);
        let meta = metadata(&from)?;
        if meta.is_dir() {
            copy_tree(&from, &to, false)?;
        } else if meta.is_file() {
            match metadata(&to) {
                Ok(meta) if meta.is_file() => {}
                Ok(_) => {
                    return Err(io::Error::other(format!(
                        "Expected a file: '{}'",
                        to.display()
                    )));
                }
                Err(e) if e.kind() == io::ErrorKind::NotFound => {}
                Err(e) => return Err(e),
            }
            fs::copy(&from, &to).map_err(|e| {
                io::Error::new(
                    e.kind(),
                    format!(
                        "Cannot copy '{}' to '{}': {e}",
                        from.display(),
                        to.display()
                    ),
                )
            })?;
        } else {
            return Err(io::Error::other(format!(
                "Unsupported payload entry: '{}'",
                from.display()
            )));
        }
    }
    Ok(())
}

/// The caller must supply an empty, private transaction directory. CUDA may
/// have been extracted separately from a bundled base payload. Copy only the
/// two accelerator packages from that staging tree, never an old base app.
pub fn copy_windows_payload(
    source: &Path,
    destination: &Path,
    cuda: Option<&Path>,
) -> io::Result<()> {
    let source = canonical(source)?;
    let destination = canonical(destination)?;
    separate(&source, &destination)?;
    if fs::read_dir(&destination)
        .map_err(|e| context("Cannot list directory", &destination, e))?
        .next()
        .transpose()
        .map_err(|e| context("Cannot read directory entry", &destination, e))?
        .is_some()
    {
        return Err(io::Error::other(format!(
            "Payload staging directory must be empty: '{}'",
            destination.display()
        )));
    }
    let cuda = cuda.map(canonical).transpose()?;
    if let Some(cuda) = cuda.as_ref() {
        separate(cuda, &destination)?;
        // Validate every intermediate directory too, before traversing it.
        let mut packages = cuda.clone();
        for component in Path::new(CUDA_PACKAGES).components() {
            packages.push(component);
            directory(&packages)?;
        }
        for variant in CUDA_VARIANTS {
            directory(&packages.join(variant))?;
        }
    }
    copy_tree(&source, &destination, true)?;
    if let Some(cuda) = cuda.filter(|cuda| cuda != &source) {
        let mut packages = destination.clone();
        for component in Path::new(CUDA_PACKAGES).components() {
            packages.push(component);
            ensure_directory(&packages)?;
        }
        for variant in CUDA_VARIANTS {
            copy_tree(
                &cuda.join(CUDA_PACKAGES).join(variant),
                &packages.join(variant),
                false,
            )?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::transaction::PayloadUpdate;
    use super::*;

    fn write(root: &Path, name: &str, contents: &[u8]) {
        let path = root.join(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, contents).unwrap();
    }

    fn cuda(root: &Path) {
        for variant in CUDA_VARIANTS {
            write(
                root,
                &format!("{CUDA_PACKAGES}/{variant}/bins/llama.dll"),
                b"CUDA",
            );
        }
    }

    #[test]
    fn fresh_install_copies_separate_cuda_without_stale_base_or_user_data() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("bundled ü app");
        let overlay = temp.path().join("download staging");
        let target = temp.path().join("Programs 用户").join("LokLM");
        write(&source, "LokLM.exe", b"new app");
        write(&source, "models/user.gguf", b"must not copy");
        write(&source, "LOKLM-TIER.JSON", b"must not copy");
        write(
            &source,
            "resources/models/config.json",
            b"application resource",
        );
        write(&overlay, "LokLM.exe", b"stale app");
        cuda(&overlay);
        let mut update = PayloadUpdate::prepare(&target, Path::new("LokLM.exe"), true, |stage| {
            copy_windows_payload(&source, stage, Some(&overlay))
        })
        .unwrap();
        update.activate().unwrap();
        update.commit().unwrap();
        assert_eq!(fs::read(target.join("LokLM.exe")).unwrap(), b"new app");
        assert!(!target.join("models/user.gguf").exists());
        assert!(!target.join("LOKLM-TIER.JSON").exists());
        assert_eq!(
            fs::read(target.join("resources/models/config.json")).unwrap(),
            b"application resource"
        );
        for variant in CUDA_VARIANTS {
            assert_eq!(
                fs::read(
                    target
                        .join(CUDA_PACKAGES)
                        .join(variant)
                        .join("bins/llama.dll")
                )
                .unwrap(),
                b"CUDA"
            );
        }
    }

    #[test]
    fn combined_download_payload_includes_cuda_and_preserves_existing_models() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("download");
        let target = temp.path().join("LokLM");
        write(&source, "LokLM.exe", b"new app");
        cuda(&source);
        write(&target, "LokLM.exe", b"old app");
        write(&target, "models/model.gguf", b"keep model");
        write(&target, "loklm-tier.json", b"keep tier");
        let mut update = PayloadUpdate::prepare(&target, Path::new("LokLM.exe"), true, |stage| {
            copy_windows_payload(&source, stage, Some(&source))
        })
        .unwrap();
        update.activate().unwrap();
        update.commit().unwrap();
        assert_eq!(fs::read(target.join("LokLM.exe")).unwrap(), b"new app");
        assert_eq!(
            fs::read(target.join("models/model.gguf")).unwrap(),
            b"keep model"
        );
        assert_eq!(
            fs::read(target.join("loklm-tier.json")).unwrap(),
            b"keep tier"
        );
        assert!(target
            .join(CUDA_PACKAGES)
            .join(CUDA_VARIANTS[0])
            .join("bins/llama.dll")
            .is_file());
    }

    #[test]
    fn missing_accelerator_reports_path_and_leaves_previous_install_untouched() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("payload");
        let overlay = temp.path().join("cuda");
        let target = temp.path().join("LokLM");
        write(&source, "LokLM.exe", b"new app");
        cuda(&overlay);
        fs::remove_dir_all(overlay.join(CUDA_PACKAGES).join(CUDA_VARIANTS[1])).unwrap();
        write(&target, "LokLM.exe", b"old app");
        write(&target, "models/model.gguf", b"keep model");
        let error = PayloadUpdate::prepare(&target, Path::new("LokLM.exe"), true, |stage| {
            copy_windows_payload(&source, stage, Some(&overlay))
        })
        .err()
        .unwrap();
        assert_eq!(error.kind(), io::ErrorKind::NotFound);
        assert!(error.to_string().contains(CUDA_VARIANTS[1]));
        assert_eq!(fs::read(target.join("LokLM.exe")).unwrap(), b"old app");
        assert_eq!(
            fs::read(target.join("models/model.gguf")).unwrap(),
            b"keep model"
        );
    }

    #[test]
    fn refuses_overlapping_or_nonempty_destinations() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("payload");
        let nested = source.join("pending");
        fs::create_dir_all(&nested).unwrap();
        write(&source, "LokLM.exe", b"keep");
        assert!(copy_windows_payload(&source, &source, None)
            .unwrap_err()
            .to_string()
            .contains("overlap"));
        assert!(copy_windows_payload(&source, &nested, None)
            .unwrap_err()
            .to_string()
            .contains("overlap"));
        assert!(copy_windows_payload(&nested, &source, None)
            .unwrap_err()
            .to_string()
            .contains("overlap"));
        let occupied = temp.path().join("occupied");
        write(&occupied, "personal.txt", b"keep");
        assert!(copy_windows_payload(&source, &occupied, None)
            .unwrap_err()
            .to_string()
            .contains("empty"));
        assert_eq!(fs::read(occupied.join("personal.txt")).unwrap(), b"keep");
        assert_eq!(fs::read(source.join("LokLM.exe")).unwrap(), b"keep");
    }

    #[test]
    fn canonical_paths_and_deep_cuda_paths_are_supported() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        let source = root.join("payload with spaces");
        let target = root.join("pending");
        fs::create_dir(&target).unwrap();
        let deep = format!(
            "{CUDA_PACKAGES}/{}/{}llama.dll",
            CUDA_VARIANTS[0],
            "long directory 名/".repeat(20)
        );
        write(&source, &deep, b"CUDA");
        copy_windows_payload(&source, &target, None).unwrap();
        assert_eq!(fs::read(target.join(deep)).unwrap(), b"CUDA");
    }

    #[cfg(windows)]
    #[test]
    fn locked_source_reports_path_and_preserves_previous_install() {
        use std::fs::OpenOptions;
        use std::os::windows::fs::OpenOptionsExt;

        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("payload");
        let target = temp.path().join("LokLM");
        write(&source, "LokLM.exe", b"new app");
        write(&target, "LokLM.exe", b"old app");
        write(&target, "models/model.gguf", b"keep model");
        let locked = OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(source.join("LokLM.exe"))
            .unwrap();
        let error = PayloadUpdate::prepare(&target, Path::new("LokLM.exe"), true, |stage| {
            copy_windows_payload(&source, stage, None)
        })
        .err()
        .unwrap();
        let message = error.to_string();
        assert!(message.contains(r"payload\LokLM.exe"), "{message}");
        assert!(message.contains("os error"), "{message}");
        assert_eq!(fs::read(target.join("LokLM.exe")).unwrap(), b"old app");
        assert_eq!(
            fs::read(target.join("models/model.gguf")).unwrap(),
            b"keep model"
        );
        drop(locked);
    }

    #[cfg(unix)]
    #[test]
    fn refuses_links_in_payload_and_cuda_ancestors() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("payload");
        let target = temp.path().join("pending");
        let outside = temp.path().join("outside");
        write(&source, "LokLM.exe", b"app");
        write(&outside, "personal.txt", b"keep");
        fs::create_dir(&target).unwrap();
        std::os::unix::fs::symlink(&outside, source.join("linked")).unwrap();
        assert!(copy_windows_payload(&source, &target, None)
            .unwrap_err()
            .to_string()
            .contains("linked"));
        fs::remove_dir_all(&target).unwrap();
        fs::create_dir(&target).unwrap();
        fs::remove_file(source.join("linked")).unwrap();
        let overlay = temp.path().join("cuda");
        fs::create_dir(&overlay).unwrap();
        std::os::unix::fs::symlink(&outside, overlay.join("resources")).unwrap();
        assert!(copy_windows_payload(&source, &target, Some(&overlay))
            .unwrap_err()
            .to_string()
            .contains("resources"));
        assert_eq!(fs::read(outside.join("personal.txt")).unwrap(), b"keep");
    }
}
