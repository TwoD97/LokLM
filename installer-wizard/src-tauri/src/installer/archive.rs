// Single-pass tar.zst extraction. Used to expand the payload + cuda
// archives the wizard downloads into the staging dir before robocopy /
// cp -r / ditto copies them to the install location.
//
// Preserve framework symlinks without allowing writes through them. Entries
// use portable relative paths; links stay inside their top-level payload tree.
// Existing staging directories are checked too. This is not an extraction
// primitive for a directory concurrently controlled by another process.

use std::collections::HashSet;
use std::fs::File;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};

fn portable_relative(path: &Path, allow_parent: bool) -> Result<PathBuf, String> {
    if path.as_os_str().is_empty() || path.to_string_lossy().contains(['\\', ':']) {
        return Err(format!("malicious tar path : {}", path.display()));
    }
    let mut relative = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(name) => relative.push(name),
            Component::CurDir => {}
            Component::ParentDir if allow_parent => relative.push(".."),
            _ => return Err(format!("malicious tar path : {}", path.display())),
        }
    }
    if relative.as_os_str().is_empty() {
        if allow_parent {
            relative.push(".");
        } else {
            return Err("empty tar path".into());
        }
    }
    Ok(relative)
}

fn normalized_link(entry: &Path, target: &Path) -> Result<PathBuf, String> {
    let target = portable_relative(target, true)?;
    let mut resolved = entry.parent().unwrap_or(Path::new("")).to_path_buf();
    for component in target.components() {
        match component {
            Component::ParentDir => {
                // A relative target may ascend inside a bundle, never above it.
                if resolved.components().count() <= 1 || !resolved.pop() {
                    return Err("symlink target escapes payload tree".into());
                }
            }
            Component::Normal(name) => resolved.push(name),
            Component::CurDir => {}
            _ => return Err("invalid symlink target".into()),
        }
    }
    if resolved.components().next() != entry.components().next() || resolved.starts_with(entry) {
        return Err("symlink target escapes payload tree or cycles".into());
    }
    Ok(resolved)
}

// Resolve existing symlink components without requiring forward targets to
// exist yet. Every expansion is relative and remains in the same payload tree.
fn resolve_link_target(root: &Path, relative: &Path) -> Result<PathBuf, String> {
    let mut target = relative.to_path_buf();
    let mut seen = HashSet::new();
    for _ in 0..64 {
        if !seen.insert(target.clone()) {
            return Err("cyclic symlink target".into());
        }
        let components: Vec<_> = target.components().collect();
        let mut prefix = PathBuf::new();
        let mut expanded = None;
        for (index, component) in components.iter().enumerate() {
            prefix.push(component.as_os_str());
            match std::fs::symlink_metadata(root.join(&prefix)) {
                Ok(info) if info.file_type().is_symlink() => {
                    let link = std::fs::read_link(root.join(&prefix))
                        .map_err(|e| format!("read staging symlink : {e}"))?;
                    let mut replacement = normalized_link(&prefix, &link)?;
                    for remaining in &components[index + 1..] {
                        replacement.push(remaining.as_os_str());
                    }
                    expanded = Some(replacement);
                    break;
                }
                Ok(info) if index + 1 < components.len() && !info.is_dir() => {
                    return Err("symlink target has a non-directory parent".into());
                }
                Ok(_) => {}
                Err(e) if e.kind() == ErrorKind::NotFound => break,
                Err(e) => return Err(format!("inspect symlink target : {e}")),
            }
        }
        match expanded {
            Some(replacement) => target = replacement,
            None => return Ok(target),
        }
    }
    Err("symlink target exceeds resolution limit".into())
}

fn validate_destination(root: &Path, relative: &Path, kind: tar::EntryType) -> Result<(), String> {
    let components: Vec<_> = relative.components().collect();
    let mut current = root.to_path_buf();
    for (index, component) in components.iter().enumerate() {
        current.push(component.as_os_str());
        let last = index + 1 == components.len();
        match std::fs::symlink_metadata(&current) {
            Ok(info) if info.file_type().is_symlink() => {
                // A retry may replace the same validated leaf link, but no
                // archive entry may write through a symlink parent or leaf.
                if !last || !kind.is_symlink() {
                    return Err("tar destination traverses a staging symlink".into());
                }
            }
            Ok(info) if (!last || kind.is_dir()) && !info.is_dir() => {
                return Err("tar destination has a non-directory parent".into());
            }
            Ok(info) if last && !kind.is_dir() && !info.is_file() => {
                return Err("tar destination has an incompatible existing entry".into());
            }
            Ok(_) => {}
            Err(e) if e.kind() == ErrorKind::NotFound => break,
            Err(e) => return Err(format!("inspect tar destination : {e}")),
        }
    }
    Ok(())
}

pub fn extract_tar_zst(archive: &Path, dest: &Path) -> Result<usize, String> {
    let f = File::open(archive).map_err(|e| format!("open {} : {}", archive.display(), e))?;
    let decoder = zstd::stream::read::Decoder::new(f).map_err(|e| format!("zstd init : {}", e))?;
    let mut tar = tar::Archive::new(decoder);
    match std::fs::symlink_metadata(dest) {
        Ok(info) if !info.is_dir() || info.file_type().is_symlink() => {
            return Err("extraction destination is not an ordinary directory".into());
        }
        Ok(_) => {}
        Err(e) if e.kind() == ErrorKind::NotFound => {}
        Err(e) => return Err(format!("inspect extraction destination : {e}")),
    }
    std::fs::create_dir_all(dest).map_err(|e| format!("mkdir {} : {}", dest.display(), e))?;
    let root =
        std::fs::canonicalize(dest).map_err(|e| format!("resolve extraction destination : {e}"))?;
    let mut count = 0usize;
    let mut seen = HashSet::new();
    let mut links = Vec::new();
    for entry in tar.entries().map_err(|e| format!("tar entries : {}", e))? {
        let mut entry = entry.map_err(|e| format!("tar entry : {}", e))?;
        let path = entry
            .path()
            .map_err(|e| format!("tar path : {}", e))?
            .into_owned();
        let relative = portable_relative(&path, false)?;
        if !seen.insert(relative.clone()) {
            return Err("duplicate tar destination".into());
        }
        let kind = entry.header().entry_type();
        if !kind.is_file() && !kind.is_dir() && !kind.is_symlink() {
            return Err("unsupported tar entry type".into());
        }
        validate_destination(&root, &relative, kind)?;
        if kind.is_symlink() {
            let link = entry
                .link_name()
                .map_err(|e| format!("tar link : {e}"))?
                .ok_or("missing symlink target")?
                .into_owned();
            let target = normalized_link(&relative, &link)?;
            let resolved = resolve_link_target(&root, &target)?;
            if resolved.starts_with(&relative) {
                return Err("cyclic symlink target".into());
            }
            // Do not silently overwrite a different leftover staging link.
            if let Ok(info) = std::fs::symlink_metadata(root.join(&relative)) {
                if info.file_type().is_symlink()
                    && std::fs::read_link(root.join(&relative))
                        .map_err(|e| format!("read staging symlink : {e}"))?
                        != link
                {
                    return Err("conflicting existing staging symlink".into());
                }
            }
            links.push(relative.clone());
        }
        let unpacked = entry
            .unpack_in(&root)
            .map_err(|e| format!("unpack {} : {}", path.display(), e))?;
        if !unpacked {
            return Err(format!("tar entry was not unpacked : {}", path.display()));
        }
        count += 1;
    }
    // Forward framework links are permitted, but a completed payload must not
    // contain dangling/cyclic links or references to special filesystem nodes.
    for link in links {
        let resolved = resolve_link_target(&root, &link)?;
        let info = std::fs::symlink_metadata(root.join(resolved))
            .map_err(|e| format!("unresolved payload symlink : {e}"))?;
        if !info.is_file() && !info.is_dir() {
            return Err("symlink target is not a regular file or directory".into());
        }
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn make_tar_zst(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut tar_buf = Vec::new();
        {
            let mut tar = tar::Builder::new(&mut tar_buf);
            for (name, data) in entries {
                let mut header = tar::Header::new_gnu();
                header.set_path(name).unwrap();
                header.set_size(data.len() as u64);
                header.set_mode(0o644);
                header.set_cksum();
                tar.append(&header, *data).unwrap();
            }
            tar.finish().unwrap();
        }
        zstd::stream::encode_all(&tar_buf[..], 3).unwrap()
    }

    fn typed_archive(entries: &[(&str, u8, &str, &[u8])]) -> Vec<u8> {
        let mut builder = tar::Builder::new(Vec::new());
        for (name, kind, link, bytes) in entries {
            let mut header = tar::Header::new_gnu();
            header.set_path(name).unwrap();
            header.set_entry_type(tar::EntryType::new(*kind));
            if !link.is_empty() {
                header.set_link_name(link).unwrap();
            }
            header.set_mode(if *kind == b'5' { 0o755 } else { 0o644 });
            header.set_size(bytes.len() as u64);
            if *kind == b'S' {
                // A valid empty sparse header must reach our unsupported-type
                // guard rather than fail early in the tar header parser.
                header.as_gnu_mut().unwrap().set_real_size(0);
            }
            header.set_cksum();
            builder.append(&header, *bytes).unwrap();
        }
        let bytes = builder.into_inner().unwrap();
        zstd::stream::encode_all(&bytes[..], 3).unwrap()
    }

    fn extract_fixture(bytes: &[u8], dir: &Path) -> Result<usize, String> {
        let archive = dir.join("fixture.tar.zst");
        std::fs::write(&archive, bytes).unwrap();
        extract_tar_zst(&archive, &dir.join("out"))
    }

    #[test]
    fn validates_portable_paths_and_internal_relative_targets_without_creating_links() {
        for bad in [
            "",
            "../escape",
            "App/../escape",
            "/absolute",
            "C:/absolute",
            r"App\escape",
            r"\\server\share",
        ] {
            assert!(portable_relative(Path::new(bad), false).is_err(), "{bad}");
        }
        let link = Path::new("LokLM.app/Contents/Frameworks/Electron.framework/Resources");
        assert_eq!(
            normalized_link(link, Path::new("Versions/Current/Resources")).unwrap(),
            Path::new(
                "LokLM.app/Contents/Frameworks/Electron.framework/Versions/Current/Resources"
            )
        );
        assert_eq!(
            normalized_link(Path::new("App/bin/tool"), Path::new("../resources/tool")).unwrap(),
            Path::new("App/resources/tool")
        );
        assert_eq!(
            normalized_link(Path::new("App/parent"), Path::new(".")).unwrap(),
            Path::new("App")
        );
        for bad in [
            "../../escape",
            "../Other/file",
            "/absolute",
            "C:/absolute",
            r"..\escape",
            "link/child",
        ] {
            assert!(
                normalized_link(Path::new("App/link"), Path::new(bad)).is_err(),
                "{bad}"
            );
        }
    }

    #[test]
    fn rejects_unsafe_link_targets_before_platform_symlink_creation() {
        for target in [
            "../../escape",
            "/absolute",
            "C:/absolute",
            r"..\escape",
            "link/child",
        ] {
            let dir = tempdir().unwrap();
            let bytes = typed_archive(&[("App/link", b'2', target, b"")]);
            assert!(extract_fixture(&bytes, dir.path()).is_err(), "{target}");
            assert!(std::fs::symlink_metadata(dir.path().join("out/App/link")).is_err());
        }
    }

    #[test]
    fn rejects_hardlinks_devices_fifos_and_other_special_entries() {
        for kind in [b'1', b'3', b'4', b'6', b'7', b'S', b'Z'] {
            let dir = tempdir().unwrap();
            let bytes = typed_archive(&[("App/entry", kind, "App/other", b"")]);
            let err = extract_fixture(&bytes, dir.path()).unwrap_err();
            assert!(err.contains("unsupported tar entry type"), "{kind}: {err}");
            assert!(!dir.path().join("out/App/entry").exists());
        }
    }

    #[test]
    fn accepts_explicit_directories_and_safe_regular_file_retries() {
        let dir = tempdir().unwrap();
        let bytes = typed_archive(&[("App", b'5', "", b""), ("App/file", b'0', "", b"fresh")]);
        assert_eq!(extract_fixture(&bytes, dir.path()).unwrap(), 2);
        assert_eq!(extract_fixture(&bytes, dir.path()).unwrap(), 2);
        assert_eq!(
            std::fs::read(dir.path().join("out/App/file")).unwrap(),
            b"fresh"
        );
    }

    #[test]
    fn rejects_duplicate_paths_instead_of_overwriting_the_first_archive_entry() {
        let dir = tempdir().unwrap();
        let bytes = make_tar_zst(&[("App/file", b"first"), ("App/file", b"second")]);
        assert!(extract_fixture(&bytes, dir.path())
            .unwrap_err()
            .contains("duplicate"));
        assert_eq!(
            std::fs::read(dir.path().join("out/App/file")).unwrap(),
            b"first"
        );
    }

    #[test]
    fn rejects_existing_non_directory_parent_without_modifying_it() {
        let dir = tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("out")).unwrap();
        std::fs::write(dir.path().join("out/App"), b"existing").unwrap();
        let err = extract_fixture(&make_tar_zst(&[("App/file", b"new")]), dir.path()).unwrap_err();
        assert!(err.contains("non-directory"));
        assert_eq!(
            std::fs::read(dir.path().join("out/App")).unwrap(),
            b"existing"
        );
    }

    #[test]
    fn regular_file_retry_unlinks_existing_hardlink_without_changing_external_bytes() {
        let dir = tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("out/App")).unwrap();
        std::fs::write(dir.path().join("external"), b"keep").unwrap();
        std::fs::hard_link(dir.path().join("external"), dir.path().join("out/App/file")).unwrap();
        extract_fixture(&make_tar_zst(&[("App/file", b"new")]), dir.path()).unwrap();
        assert_eq!(std::fs::read(dir.path().join("external")).unwrap(), b"keep");
        assert_eq!(
            std::fs::read(dir.path().join("out/App/file")).unwrap(),
            b"new"
        );
    }

    #[cfg(unix)]
    #[test]
    fn preserves_forward_framework_symlinks_and_retries_identical_links() {
        let dir = tempdir().unwrap();
        let bytes = typed_archive(&[
            (
                "LokLM.app/Framework/Resources",
                b'2',
                "Versions/Current/Resources",
                b"",
            ),
            ("LokLM.app/Framework/Versions", b'5', "", b""),
            ("LokLM.app/Framework/Versions/Current", b'2', "A", b""),
            (
                "LokLM.app/Framework/Versions/A/Resources/info",
                b'0',
                "",
                b"signed resource",
            ),
        ]);
        assert_eq!(extract_fixture(&bytes, dir.path()).unwrap(), 4);
        let link = dir.path().join("out/LokLM.app/Framework/Resources");
        assert!(std::fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(
            std::fs::read_link(&link).unwrap(),
            Path::new("Versions/Current/Resources")
        );
        assert_eq!(
            std::fs::read(link.join("info")).unwrap(),
            b"signed resource"
        );
        assert_eq!(extract_fixture(&bytes, dir.path()).unwrap(), 4);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_archive_writes_through_internal_symlink_parents() {
        let dir = tempdir().unwrap();
        let bytes = typed_archive(&[
            ("App/real", b'5', "", b""),
            ("App/alias", b'2', "real", b""),
            ("App/alias/file", b'0', "", b"bad"),
        ]);
        assert!(extract_fixture(&bytes, dir.path())
            .unwrap_err()
            .contains("staging symlink"));
        assert!(!dir.path().join("out/App/real/file").exists());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_existing_symlink_root_parents_and_file_leaves() {
        use std::os::unix::fs::symlink;
        for placement in ["root", "parent", "leaf"] {
            let dir = tempdir().unwrap();
            let outside = dir.path().join("outside");
            std::fs::create_dir_all(&outside).unwrap();
            std::fs::write(outside.join("file"), b"keep").unwrap();
            match placement {
                "root" => symlink(&outside, dir.path().join("out")).unwrap(),
                "parent" => {
                    std::fs::create_dir_all(dir.path().join("out")).unwrap();
                    symlink(&outside, dir.path().join("out/App")).unwrap();
                }
                _ => {
                    std::fs::create_dir_all(dir.path().join("out/App")).unwrap();
                    symlink(outside.join("file"), dir.path().join("out/App/file")).unwrap();
                }
            }
            assert!(extract_fixture(&make_tar_zst(&[("App/file", b"bad")]), dir.path()).is_err());
            assert_eq!(std::fs::read(outside.join("file")).unwrap(), b"keep");
        }
    }

    #[cfg(unix)]
    #[test]
    fn rejects_escaping_existing_target_chains_and_conflicting_staging_links() {
        use std::os::unix::fs::symlink;
        let dir = tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("out/App")).unwrap();
        std::fs::create_dir_all(dir.path().join("outside")).unwrap();
        symlink(
            dir.path().join("outside"),
            dir.path().join("out/App/escape"),
        )
        .unwrap();
        let bytes = typed_archive(&[("App/link", b'2', "escape/file", b"")]);
        assert!(extract_fixture(&bytes, dir.path()).is_err());
        assert!(std::fs::symlink_metadata(dir.path().join("out/App/link")).is_err());
        symlink("old", dir.path().join("out/App/link")).unwrap();
        let bytes = typed_archive(&[("App/link", b'2', "new", b"")]);
        assert!(extract_fixture(&bytes, dir.path())
            .unwrap_err()
            .contains("conflicting existing"));
        assert_eq!(
            std::fs::read_link(dir.path().join("out/App/link")).unwrap(),
            Path::new("old")
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_dangling_or_cyclic_final_links() {
        for entries in [
            vec![("App/link", b'2', "missing", b"".as_slice())],
            vec![
                ("App/first", b'2', "second", b"".as_slice()),
                ("App/second", b'2', "first", b"".as_slice()),
            ],
        ] {
            let dir = tempdir().unwrap();
            assert!(extract_fixture(&typed_archive(&entries), dir.path()).is_err());
        }
    }

    #[test]
    fn extracts_well_formed_archive() {
        let dir = tempdir().unwrap();
        let arch = dir.path().join("a.tar.zst");
        let data = make_tar_zst(&[("a/b.txt", b"hello"), ("c.txt", b"world")]);
        std::fs::write(&arch, data).unwrap();
        let dest = dir.path().join("out");
        let n = extract_tar_zst(&arch, &dest).unwrap();
        assert_eq!(n, 2);
        assert_eq!(std::fs::read(dest.join("a/b.txt")).unwrap(), b"hello");
        assert_eq!(std::fs::read(dest.join("c.txt")).unwrap(), b"world");
    }

    #[test]
    fn rejects_path_traversal() {
        // tar-rs's `Header::set_path` refuses to write `..` segments , so we
        // hand-craft a raw 512-byte tar header to bypass that guard and
        // exercise our extract-side check directly.
        let mut tar_buf = vec![0u8; 1024];
        let name = b"../escape.txt";
        tar_buf[..name.len()].copy_from_slice(name);
        // mode + uid + gid + size + mtime , all octal-ASCII , size = 0
        tar_buf[100..108].copy_from_slice(b"0000644\0");
        tar_buf[108..116].copy_from_slice(b"0000000\0");
        tar_buf[116..124].copy_from_slice(b"0000000\0");
        tar_buf[124..136].copy_from_slice(b"00000000000\0");
        tar_buf[136..148].copy_from_slice(b"00000000000\0");
        // Checksum field starts as spaces ( per the spec ) , gets filled in
        // after summing every byte in the header.
        tar_buf[148..156].copy_from_slice(b"        ");
        tar_buf[156] = b'0'; // typeflag = regular file
        tar_buf[257..263].copy_from_slice(b"ustar\0");
        tar_buf[263..265].copy_from_slice(b"00");
        let sum: u32 = tar_buf[..512].iter().map(|&b| b as u32).sum();
        let chk = format!("{:06o}\0 ", sum);
        tar_buf[148..156].copy_from_slice(chk.as_bytes());
        // bytes 512..1024 are the all-zero end-of-archive marker.

        let compressed = zstd::stream::encode_all(&tar_buf[..], 3).unwrap();
        let dir = tempdir().unwrap();
        let arch = dir.path().join("a.tar.zst");
        std::fs::write(&arch, compressed).unwrap();
        let dest = dir.path().join("out");
        let err = extract_tar_zst(&arch, &dest).unwrap_err();
        assert!(err.contains("malicious"), "got : {}", err);
    }
}
