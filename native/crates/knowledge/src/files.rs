//! Portable source format. The daemon is a read-only consumer of the vault.
//! Explicit import creates new notes; existing files are never silently rewritten.
use anyhow::{Context, Result, bail, ensure};
use cap_std::{ambient_authority, fs::Dir};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};
use uuid::Uuid;

pub const MAX_BYTES: u64 = 4 * 1024 * 1024;
pub const MAX_FILES: usize = 100_000;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Source {
    pub id: String,
    pub path: String,
    pub hash: String,
    pub markdown: String,
    pub backlinks: Vec<String>,
}

pub fn relative(path: &str) -> Result<&Path> {
    ensure!(
        !path.is_empty() && !path.contains(['\\', ':', '\0']),
        "invalid vault path"
    );
    let p = Path::new(path);
    ensure!(
        p.components().all(|c| matches!(c, Component::Normal(_))),
        "invalid vault path"
    );
    ensure!(
        p.components()
            .all(|c| !c.as_os_str().to_string_lossy().starts_with('.')),
        "hidden path excluded"
    );
    Ok(p)
}

pub struct Vault {
    root: PathBuf,
    dir: Dir,
}
impl Vault {
    pub fn open(root: &Path) -> Result<Self> {
        ensure!(
            !root.symlink_metadata()?.file_type().is_symlink(),
            "vault root is a symlink"
        );
        let root = root.canonicalize()?;
        let dir = Dir::open_ambient_dir(&root, ambient_authority())?;
        Ok(Self { root, dir })
    }
    pub fn root(&self) -> &Path {
        &self.root
    }
    pub fn read(&self, path: &str) -> Result<String> {
        let rel = relative(path)?;
        let mut current = PathBuf::new();
        for c in rel.components() {
            current.push(c);
            ensure!(
                !self
                    .dir
                    .symlink_metadata(&current)?
                    .file_type()
                    .is_symlink(),
                "symlink excluded"
            );
        }
        let file = self.dir.open(rel)?; // capability boundary also prevents traversal during races
        let meta = file.metadata()?;
        ensure!(
            meta.is_file() && meta.len() <= MAX_BYTES,
            "not a bounded regular file"
        );
        let mut bytes = Vec::new();
        file.take(MAX_BYTES + 1).read_to_end(&mut bytes)?;
        ensure!(bytes.len() as u64 <= MAX_BYTES, "file grew beyond limit");
        let text = String::from_utf8(bytes).context("invalid UTF-8")?;
        ensure!(!text.contains('\0'), "NUL in document");
        Ok(text)
    }
    pub fn scan(&self) -> Result<Vec<Source>> {
        let mut out = Vec::new();
        let mut seen = HashSet::new();
        let mut entries = 0usize;
        let mut total_bytes = 0usize;
        for entry in walkdir::WalkDir::new(&self.root)
            .follow_links(false)
            .max_depth(32)
            .into_iter()
            .filter_entry(|e| e.depth() == 0 || !e.file_name().to_string_lossy().starts_with('.'))
        {
            let entry = entry?;
            entries += 1;
            ensure!(entries <= MAX_FILES, "vault entry count exceeds bound");
            ensure!(
                entry.depth() < 32 || !entry.file_type().is_dir(),
                "vault depth exceeds bound"
            );
            if entry.file_type().is_symlink() {
                bail!("symlink in vault; reconciliation refused");
            }
            if !entry.file_type().is_file() {
                continue;
            }
            let p = entry
                .path()
                .strip_prefix(&self.root)?
                .to_str()
                .context("non UTF-8 path")?
                .replace('\\', "/");
            if !p.to_ascii_lowercase().ends_with(".md") {
                continue;
            }
            ensure!(out.len() < MAX_FILES, "vault exceeds file limit");
            let text = self.read(&p)?;
            total_bytes += text.len();
            ensure!(
                total_bytes <= 64 * 1024 * 1024,
                "vault text scan exceeds 64 MiB budget"
            );
            let id = source_id(&text).with_context(|| format!("note needs valid loklm_id: {p}"))?;
            ensure!(
                seen.insert(id.clone()),
                "duplicate loklm_id; reconciliation refused"
            );
            out.push(Source {
                id,
                path: p,
                hash: crate::digest(&text),
                backlinks: links(&text),
                markdown: text,
            });
        }
        out.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(out)
    }
    /// Only creates new paths. fsync + same-directory rename with no overwrite.
    /// Run with the sync sidecar stopped; `import` never adopts a live existing file.
    pub fn import(&self, path: &str, text: &str) -> Result<String> {
        let rel = relative(path)?;
        ensure!(
            path.ends_with(".md") && text.len() as u64 <= MAX_BYTES - 128,
            "invalid import"
        );
        ensure!(!self.dir.try_exists(rel)?, "destination already exists");
        let parent = rel.parent().unwrap_or(Path::new(""));
        if !parent.as_os_str().is_empty() {
            self.dir.create_dir_all(parent)?;
        }
        let id = Uuid::new_v4().to_string();
        let body = text.trim_start_matches('\u{feff}');
        let content = if let Some(rest) = body.strip_prefix("---\r\n") {
            format!("---\r\nloklm_id: {id}\r\n{rest}")
        } else if let Some(rest) = body.strip_prefix("---\n") {
            format!("---\nloklm_id: {id}\n{rest}")
        } else {
            format!("---\nloklm_id: {id}\n---\n{body}")
        };
        ensure!(
            source_id(&content)? == id,
            "input already contains loklm_id"
        );
        let tmp = parent.join(format!(".loklm-{}.tmp", Uuid::new_v4()));
        let mut options = cap_std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        let mut f = self.dir.open_with(&tmp, &options)?;
        f.write_all(content.as_bytes())?;
        f.sync_all()?;
        drop(f);
        // Hard-link publishes atomically and fails if a concurrent editor created destination.
        let result = self.dir.hard_link(&tmp, &self.dir, rel);
        self.dir.remove_file(tmp)?;
        result?;
        #[cfg(unix)]
        self.dir
            .open(if parent.as_os_str().is_empty() {
                Path::new(".")
            } else {
                parent
            })?
            .sync_all()?;
        Ok(id)
    }
}

pub fn source_id(text: &str) -> Result<String> {
    let text = text.trim_start_matches('\u{feff}').replace("\r\n", "\n");
    let rest = text.strip_prefix("---\n").context("missing frontmatter")?;
    let end = rest.find("\n---").context("unclosed frontmatter")?;
    ensure!(end < 16_384, "frontmatter too large");
    let ids: Vec<_> = rest[..end]
        .lines()
        .filter_map(|l| l.strip_prefix("loklm_id:"))
        .collect();
    ensure!(ids.len() == 1, "exactly one loklm_id required");
    Ok(Uuid::parse_str(ids[0].trim().trim_matches(['\'', '"']))?.to_string())
}
fn links(text: &str) -> Vec<String> {
    text.split("[[")
        .skip(1)
        .filter_map(|x| x.split_once("]]"))
        .map(|(x, _)| x.split('|').next().unwrap_or(x).to_string())
        .take(4096)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn portable_id_and_safe_import() -> Result<()> {
        let t = tempfile::tempdir()?;
        let v = Vault::open(t.path())?;
        let id = v.import("Grüße/Überblick.md", "# Hello\nWissen [[Quelle]]")?;
        assert!(v.import("Grüße/Überblick.md", "overwrite").is_err());
        std::fs::rename(
            t.path().join("Grüße/Überblick.md"),
            t.path().join("Renamed.md"),
        )?;
        let notes = v.scan()?;
        assert_eq!(notes[0].id, id);
        assert_eq!(notes[0].backlinks, vec!["Quelle"]);
        assert!(v.read("../escape.md").is_err());
        assert!(v.read("C:/escape.md").is_err());
        Ok(())
    }
    #[test]
    fn duplicates_and_hostile_input_fail_closed() -> Result<()> {
        let t = tempfile::tempdir()?;
        let v = Vault::open(t.path())?;
        v.import("a.md", "Text")?;
        std::fs::copy(t.path().join("a.md"), t.path().join("b.md"))?;
        assert!(v.scan().is_err());
        assert!(source_id("---\nloklm_id: !!evil\n---\n").is_err());
        Ok(())
    }
    #[cfg(unix)]
    #[test]
    fn rejects_symlink() -> Result<()> {
        let t = tempfile::tempdir()?;
        let v = Vault::open(t.path())?;
        std::os::unix::fs::symlink("/etc/passwd", t.path().join("bad.md"))?;
        assert!(v.read("bad.md").is_err());
        assert!(v.scan().is_err());
        Ok(())
    }
}
