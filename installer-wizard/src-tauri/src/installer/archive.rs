// Single-pass tar.zst extraction. Used to expand the payload + cuda
// archives the wizard downloads into the staging dir before robocopy /
// cp -r / ditto copies them to the install location.
//
// Safety : we reject any tar entry whose path is absolute or contains
// a `..` component. `tar::Archive::unpack_in` already strips traversal
// segments , but failing loudly when one is present is safer than
// silently rewriting the path.

use std::fs::File;
use std::path::Path;

pub fn extract_tar_zst(archive: &Path, dest: &Path) -> Result<usize, String> {
    let f = File::open(archive).map_err(|e| format!("open {} : {}", archive.display(), e))?;
    let decoder = zstd::stream::read::Decoder::new(f).map_err(|e| format!("zstd init : {}", e))?;
    let mut tar = tar::Archive::new(decoder);
    std::fs::create_dir_all(dest).map_err(|e| format!("mkdir {} : {}", dest.display(), e))?;
    let mut count = 0usize;
    for entry in tar.entries().map_err(|e| format!("tar entries : {}", e))? {
        let mut entry = entry.map_err(|e| format!("tar entry : {}", e))?;
        let path = entry.path().map_err(|e| format!("tar path : {}", e))?.into_owned();
        if path.is_absolute()
            || path
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            return Err(format!("malicious tar entry : {}", path.display()));
        }
        entry
            .unpack_in(dest)
            .map_err(|e| format!("unpack {} : {}", path.display(), e))?;
        count += 1;
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
