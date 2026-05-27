// Compile-time-baked payload manifest. The JSON file lives at
// installer-wizard/payload-manifest.json so the Node build scripts
// ( scripts/write-payload-manifest.mjs ) can author it ; here we just
// parse the bytes that include_str! captured at build time.
//
// The build pipeline regenerates payload-manifest.json from the .sha256
// sidecars in release/ AFTER `package:<plat>:archive` and BEFORE
// `package:<plat>:wizard` , so the hashes baked into the wizard binary
// match what was just uploaded to Bunny exactly.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PayloadManifest {
    pub version: String,
    pub base_url: String,
    pub platforms: HashMap<String, PlatformBundle>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlatformBundle {
    pub payload: ArchiveEntry,
    #[serde(default)]
    pub cuda: Option<ArchiveEntry>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveEntry {
    pub filename: String,
    pub sha256: String,
    pub size_bytes: u64,
}

const MANIFEST_JSON: &str = include_str!("../../../payload-manifest.json");

pub fn manifest() -> &'static PayloadManifest {
    static CACHE: OnceLock<PayloadManifest> = OnceLock::new();
    CACHE.get_or_init(|| {
        serde_json::from_str(MANIFEST_JSON)
            .expect("payload-manifest.json failed to parse at startup")
    })
}

pub fn current_platform_key() -> &'static str {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        "win-x64"
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        "linux-x64"
    }
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        "mac-arm64"
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        "mac-x64"
    }
    #[cfg(not(any(
        all(target_os = "windows", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "x86_64"),
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
    )))]
    {
        compile_error!("unsupported target for payload manifest")
    }
}

pub fn current_bundle() -> &'static PlatformBundle {
    let key = current_platform_key();
    manifest()
        .platforms
        .get(key)
        .unwrap_or_else(|| panic!("payload-manifest.json missing platform '{}'", key))
}

pub fn payload_url() -> String {
    let b = current_bundle();
    format!("{}/{}", manifest().base_url, b.payload.filename)
}

pub fn cuda_url() -> Option<String> {
    let b = current_bundle();
    b.cuda.as_ref().map(|c| format!("{}/{}", manifest().base_url, c.filename))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_baked_manifest_at_startup() {
        let m = manifest();
        assert!(!m.version.is_empty());
        assert!(m.base_url.starts_with("http"));
        assert!(m.platforms.contains_key("win-x64"));
    }

    #[test]
    fn mac_bundle_has_no_cuda() {
        let m = manifest();
        let mac = m.platforms.get("mac-arm64").expect("mac-arm64 present");
        assert!(mac.cuda.is_none());
    }

    #[test]
    fn payload_url_combines_base_and_filename() {
        let url = payload_url();
        assert!(url.contains("payload-"));
        assert!(url.contains(".tar.zst"));
    }
}
