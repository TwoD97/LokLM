use crate::{
    Error, Result,
    crypto::{self, Secret, WrappedKey},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use unicode_normalization::UnicodeNormalization;
use zeroize::Zeroizing;

const MAGIC: &[u8; 8] = b"LOKLM06\0";
const MAX_VAULT: u64 = 32 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Header {
    pub version: u32,
    pub display_name: String,
    pub password_salt: String,
    pub password_wrapped_dek: WrappedKey,
    pub recovery_entries: Vec<RecoveryEntry>,
    pub recovery_lang: String,
    pub created_at: u64,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryEntry {
    pub salt: String,
    pub wrapped_dek: WrappedKey,
    pub created_at: u64,
    pub used_at: Option<u64>,
}

/// Preserve unknown manifest/KV fields verbatim when writing v6. No implicit
/// v4/v5 migration: those formats can contain otherwise unrepresented records.
pub struct Vault {
    pub header: Header,
    pub body: Value,
    pub(crate) dek: Secret,
    pub loaded_from_backup: bool,
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn read_limited(path: &Path) -> Result<Vec<u8>> {
    let f = fs::File::open(path)?;
    if f.metadata()?.len() > MAX_VAULT {
        return Err(Error::Invalid("Vault exceeds size limit".into()));
    }
    let mut bytes = Vec::new();
    f.take(MAX_VAULT + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_VAULT {
        return Err(Error::Invalid("Vault exceeds size limit".into()));
    }
    Ok(bytes)
}

pub fn backup_path(path: &Path) -> PathBuf {
    path.with_extension("vault.bak")
}

impl Vault {
    pub fn open(path: &Path, password: &[u8]) -> Result<Self> {
        let primary = read_limited(path).and_then(|b| Self::decode(&b, password, false));
        match primary {
            Ok(v) => Ok(v),
            Err(e @ Error::Unsupported(_)) => Err(e),
            Err(primary_error) => {
                // A backup is never automatically written back over the primary.
                if let Ok(mut v) =
                    read_limited(&backup_path(path)).and_then(|b| Self::decode(&b, password, false))
                {
                    v.loaded_from_backup = true;
                    Ok(v)
                } else {
                    Err(primary_error)
                }
            }
        }
    }
    pub fn decode(bytes: &[u8], secret: &[u8], recovery: bool) -> Result<Self> {
        if bytes.len() < 40 || bytes.len() as u64 > MAX_VAULT {
            return Err(Error::Authentication);
        }
        if &bytes[..8] != MAGIC {
            return Err(Error::Unsupported(
                "Only v6 vaults are readable; v4/v5 need lossless export".into(),
            ));
        }
        let n = u32::from_be_bytes(bytes[8..12].try_into().unwrap()) as usize;
        if n > 1024 * 1024 || 12 + n + 28 > bytes.len() {
            return Err(Error::Authentication);
        }
        let header: Header = serde_json::from_slice(&bytes[12..12 + n])?;
        if header.version != 6 || header.recovery_entries.len() > 32 {
            return Err(Error::Authentication);
        }
        let dek = if recovery {
            let text = std::str::from_utf8(secret).map_err(|_| Error::Authentication)?;
            let normalized = Zeroizing::new(
                text.nfc()
                    .collect::<String>()
                    .to_lowercase()
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" "),
            );
            let mut recovered = None;
            for entry in header
                .recovery_entries
                .iter()
                .filter(|e| e.used_at.is_none())
            {
                let key = crypto::derive(normalized.as_bytes(), &crypto::decode(&entry.salt)?)?;
                if let Ok(dek) = crypto::unwrap(&key, &entry.wrapped_dek) {
                    recovered = Some(dek);
                    break;
                }
            }
            recovered.ok_or(Error::Authentication)?
        } else {
            let kek = crypto::derive(secret, &crypto::decode(&header.password_salt)?)?;
            crypto::unwrap(&kek, &header.password_wrapped_dek)?
        };
        let frame = &bytes[12 + n..];
        let mut ct = frame[28..].to_vec();
        ct.extend(&frame[12..28]);
        let clear = crypto::decrypt(&dek, &frame[..12], &ct, &[])?;
        let body: Value = serde_json::from_slice(&clear)?;
        if body.pointer("/manifest/version") != Some(&json!(1))
            || !body["manifest"]["workspaces"].is_array()
            || !body["kv"].is_object()
        {
            return Err(Error::Unsupported(
                "Vault manifest or key/value schema".into(),
            ));
        }
        Ok(Self {
            header,
            body,
            dek,
            loaded_from_backup: false,
        })
    }
    pub fn create(name: &str, password: &[u8], recovery: &[u8]) -> Result<Self> {
        validate_password(password)?;
        if name.trim().is_empty() || name.len() > 200 || recovery.len() < 32 {
            return Err(Error::Invalid("Display name or recovery phrase".into()));
        }
        let dek = Zeroizing::new(crypto::random::<32>().to_vec());
        let salt = crypto::random::<32>();
        let recovery_salt = crypto::random::<32>();
        let kek = crypto::derive(password, &salt)?;
        let recovery_kek = crypto::derive(recovery, &recovery_salt)?;
        Ok(Self {
            header: Header {
                version: 6,
                display_name: name.trim().into(),
                password_salt: crypto::encode(&salt),
                password_wrapped_dek: crypto::wrap(&kek, &dek)?,
                recovery_lang: "en".into(),
                created_at: now_ms(),
                extra: Default::default(),
                recovery_entries: vec![RecoveryEntry {
                    salt: crypto::encode(&recovery_salt),
                    wrapped_dek: crypto::wrap(&recovery_kek, &dek)?,
                    created_at: now_ms(),
                    used_at: None,
                }],
            },
            body: json!({"manifest":{"version":1,"defaultWorkspaceId":null,"workspaces":[]},"kv":{}}),
            dek,
            loaded_from_backup: false,
        })
    }
    pub fn encode(&self) -> Result<Vec<u8>> {
        let header = serde_json::to_vec(&self.header)?;
        let clear = Zeroizing::new(serde_json::to_vec(&self.body)?);
        let nonce = crypto::random::<12>();
        let ct = crypto::encrypt(&self.dek, &nonce, &clear, &[])?;
        let mut out = MAGIC.to_vec();
        out.extend((header.len() as u32).to_be_bytes());
        out.extend(header);
        out.extend(nonce);
        out.extend(&ct[ct.len() - 16..]);
        out.extend(&ct[..ct.len() - 16]);
        Ok(out)
    }
    pub fn persist(&self, path: &Path) -> Result<()> {
        if self.loaded_from_backup {
            return Err(Error::Invalid(
                "Backup recovery requires an explicit copy; primary preserved".into(),
            ));
        }
        let bytes = self.encode()?;
        atomic_write(path, &bytes)?;
        if let Err(e) = atomic_write(&backup_path(path), &bytes) {
            // Old wrapping credentials must not survive a re-key backup failure.
            match fs::remove_file(backup_path(path)) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(e.into()),
            }
            return Err(e);
        }
        Ok(())
    }
    pub fn workspace_key(&self, id: u64) -> Result<(String, Secret)> {
        let entry = self.body["manifest"]["workspaces"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["id"].as_u64() == Some(id))
            .ok_or(Error::Revoked)?;
        let dir = entry["dir"].as_str().ok_or(Error::Authentication)?;
        // Stored paths are untrusted. Only a single normal component is accepted.
        if dir.is_empty()
            || !dir
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
        {
            return Err(Error::Authentication);
        }
        let wrapped: WrappedKey = serde_json::from_value(entry["wrappedKey"].clone())?;
        Ok((dir.into(), crypto::unwrap(&self.dek, &wrapped)?))
    }
}

pub fn validate_password(password: &[u8]) -> Result<()> {
    let s =
        std::str::from_utf8(password).map_err(|_| Error::Invalid("Password encoding".into()))?;
    let classes = [
        s.chars().any(|c| c.is_ascii_uppercase()),
        s.chars().any(|c| c.is_ascii_lowercase()),
        s.chars().any(|c| c.is_ascii_digit()),
        s.chars().any(|c| !c.is_ascii_alphanumeric()),
    ];
    if s.chars().count() < 10 || s.len() > 4096 || classes.iter().filter(|&&b| b).count() < 3 {
        return Err(Error::Invalid(
            "Use at least 10 characters and 3 of uppercase, lowercase, digits, symbols".into(),
        ));
    }
    Ok(())
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| Error::Invalid("Missing parent directory".into()))?;
    fs::create_dir_all(parent)?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)?;
    temp.write_all(bytes)?;
    temp.as_file().sync_all()?;
    temp.persist(path).map_err(|e| Error::Io(e.error))?;
    #[cfg(unix)]
    fs::File::open(parent)?.sync_all()?;
    Ok(())
}
