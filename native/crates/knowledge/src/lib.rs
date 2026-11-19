pub mod answer;
pub mod files;
pub mod index;
#[cfg(feature = "lance")]
pub mod lance;
pub mod models;
pub mod service;

pub fn digest(bytes: impl AsRef<[u8]>) -> String {
    use sha2::{Digest, Sha256};
    hex::encode(Sha256::digest(bytes.as_ref()))
}
