//! Copy-only staging. Never rewrites an original vault or vector index. A
//! complete tree is hash-verified before the destination directory is published.
use crate::{Error, Result, session::Ticket};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

#[derive(Serialize)]
pub struct CopyReceipt {
    pub version: u32,
    pub files: Vec<FileReceipt>,
    pub total_bytes: u64,
}
#[derive(Serialize)]
pub struct FileReceipt {
    pub relative_path: String,
    pub bytes: u64,
    pub sha256: String,
}

fn files(root: &Path, relative: &Path, out: &mut Vec<PathBuf>) -> Result<()> {
    for entry in fs::read_dir(root.join(relative))? {
        let entry = entry?;
        let metadata = fs::symlink_metadata(entry.path())?;
        if metadata.file_type().is_symlink() {
            return Err(Error::Invalid("Migration refuses symbolic links".into()));
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err(Error::Invalid("Migration refuses reparse points".into()));
            }
        }
        let rel = relative.join(entry.file_name());
        if metadata.is_dir() {
            files(root, &rel, out)?;
        } else if metadata.is_file() {
            out.push(rel);
        } else {
            return Err(Error::Invalid("Unsupported filesystem entry".into()));
        }
    }
    Ok(())
}
fn hash_file(path: &Path, ticket: &Ticket) -> Result<(u64, String)> {
    let mut file = fs::File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 65536];
    let mut size = 0;
    loop {
        ticket.check()?;
        let n = file.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        digest.update(&buffer[..n]);
        size += n as u64;
    }
    Ok((size, hex::encode(digest.finalize())))
}
/// Caller must first close the original application. Concurrent source changes
/// fail validation; originals remain untouched. No schema/index conversion occurs.
pub fn copy_snapshot(
    source: &Path,
    destination: &Path,
    max_bytes: u64,
    ticket: &Ticket,
) -> Result<CopyReceipt> {
    ticket.check()?;
    let source = fs::canonicalize(source)?;
    if destination.exists() {
        return Err(Error::Invalid(
            "Migration destination already exists".into(),
        ));
    }
    let parent = destination
        .parent()
        .ok_or(Error::Invalid("Destination parent required".into()))?;
    fs::create_dir_all(parent)?;
    let parent = fs::canonicalize(parent)?;
    if parent.starts_with(&source) {
        return Err(Error::Invalid(
            "Destination must be outside the source".into(),
        ));
    }
    let target = parent.join(
        destination
            .file_name()
            .ok_or(Error::Invalid("Destination name required".into()))?,
    );
    if !source.join("loklm.vault").is_file() {
        return Err(Error::Invalid("Missing vault snapshot".into()));
    }
    // Live SQLite journal files indicate that the application may still own it.
    let mut before = vec![];
    files(&source, Path::new(""), &mut before)?;
    before.sort();
    if before
        .iter()
        .any(|p| p.to_string_lossy().ends_with("-wal") || p.to_string_lossy().ends_with("-journal"))
    {
        return Err(Error::Invalid(
            "Close the source app and checkpoint SQLite before copying".into(),
        ));
    }
    let stage = tempfile::Builder::new()
        .prefix(".loklm-copy-")
        .tempdir_in(&parent)?;
    let mut receipt = CopyReceipt {
        version: 1,
        files: vec![],
        total_bytes: 0,
    };
    for relative in &before {
        ticket.check()?;
        let (bytes, sha256) = hash_file(&source.join(relative), ticket)?;
        receipt.total_bytes = receipt
            .total_bytes
            .checked_add(bytes)
            .ok_or(Error::Invalid("Copy size overflow".into()))?;
        if receipt.total_bytes > max_bytes {
            return Err(Error::Invalid("Copy exceeds configured size limit".into()));
        }
        let dest = stage.path().join(relative);
        fs::create_dir_all(dest.parent().unwrap())?;
        fs::copy(source.join(relative), &dest)?;
        fs::OpenOptions::new().write(true).open(&dest)?.sync_all()?;
        if hash_file(&dest, ticket)? != (bytes, sha256.clone())
            || hash_file(&source.join(relative), ticket)? != (bytes, sha256.clone())
        {
            return Err(Error::Invalid(
                "Source changed during copy; original preserved".into(),
            ));
        }
        receipt.files.push(FileReceipt {
            relative_path: relative.to_string_lossy().replace('\\', "/"),
            bytes,
            sha256,
        });
    }
    let mut after = vec![];
    files(&source, Path::new(""), &mut after)?;
    after.sort();
    if before != after {
        return Err(Error::Invalid("Source tree changed during copy".into()));
    }
    for f in &receipt.files {
        if hash_file(&source.join(&f.relative_path), ticket)? != (f.bytes, f.sha256.clone()) {
            return Err(Error::Invalid("Source changed before publication".into()));
        }
    }
    let mut manifest = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(stage.path().join("native-copy-receipt.json"))?;
    manifest.write_all(&serde_json::to_vec_pretty(&receipt)?)?;
    manifest.sync_all()?;
    drop(manifest);
    ticket.check()?;
    fs::rename(stage.path(), &target)?;
    #[cfg(unix)]
    fs::File::open(&parent)?.sync_all()?;
    Ok(receipt)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::Sessions;
    #[test]
    fn copy_preserves_all_bytes_and_refuses_overwrite() {
        let root = tempfile::tempdir().unwrap();
        let src = root.path().join("source");
        let dst = root.path().join("candidate");
        fs::create_dir_all(src.join("workspaces/ws-1/enc")).unwrap();
        fs::write(src.join("loklm.vault"), b"synthetic opaque vault").unwrap();
        fs::write(
            src.join("workspaces/ws-1/enc/all-records"),
            b"embeddings metadata citations",
        )
        .unwrap();
        let sessions = Sessions::default();
        sessions.publish(sessions.epoch()).unwrap();
        let t = sessions.ticket().unwrap();
        let receipt = copy_snapshot(&src, &dst, 1024, &t).unwrap();
        assert_eq!(receipt.files.len(), 2);
        assert_eq!(
            fs::read(src.join("loklm.vault")).unwrap(),
            fs::read(dst.join("loklm.vault")).unwrap()
        );
        assert!(copy_snapshot(&src, &dst, 1024, &t).is_err());
        let cancel = sessions.ticket().unwrap();
        cancel.cancel();
        assert!(copy_snapshot(&src, &root.path().join("cancelled"), 1024, &cancel).is_err());
        assert!(!root.path().join("cancelled").exists());
        assert!(copy_snapshot(&src, &root.path().join("too-small"), 1, &t).is_err());
        assert!(!root.path().join("too-small").exists());
    }
}
