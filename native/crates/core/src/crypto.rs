//! Existing LokLM wire formats: wrapped keys use ciphertext||tag; blocks use
//! nonce||tag||ciphertext. Never log secrets or ciphertext-derived plaintext.
use crate::{Error, Result};
use aes_gcm::{
    Aes256Gcm, KeyInit, Nonce,
    aead::{Aead, Payload},
};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{Engine, engine::general_purpose::STANDARD};
use rand::{RngCore, rngs::OsRng};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

pub type Secret = Zeroizing<Vec<u8>>;

#[derive(Clone, Serialize, Deserialize)]
pub struct WrappedKey {
    pub nonce: String,
    pub ciphertext: String,
}

pub fn random<const N: usize>() -> [u8; N] {
    let mut b = [0; N];
    OsRng.fill_bytes(&mut b);
    b
}
pub fn encode(bytes: &[u8]) -> String {
    STANDARD.encode(bytes)
}
pub fn decode(s: &str) -> Result<Vec<u8>> {
    STANDARD.decode(s).map_err(|_| Error::Authentication)
}
pub fn derive(secret: &[u8], salt: &[u8]) -> Result<Secret> {
    if salt.len() != 32 || secret.len() > 4096 {
        return Err(Error::Authentication);
    }
    let params = Params::new(65536, 3, 4, Some(32)).map_err(|_| Error::Authentication)?;
    let mut out = Zeroizing::new(vec![0; 32]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(secret, salt, &mut out)
        .map_err(|_| Error::Authentication)?;
    Ok(out)
}
pub fn encrypt(key: &[u8], nonce: &[u8], data: &[u8], aad: &[u8]) -> Result<Vec<u8>> {
    if nonce.len() != 12 {
        return Err(Error::Authentication);
    }
    Aes256Gcm::new_from_slice(key)
        .map_err(|_| Error::Authentication)?
        .encrypt(Nonce::from_slice(nonce), Payload { msg: data, aad })
        .map_err(|_| Error::Authentication)
}
pub fn decrypt(key: &[u8], nonce: &[u8], data: &[u8], aad: &[u8]) -> Result<Secret> {
    if nonce.len() != 12 {
        return Err(Error::Authentication);
    }
    let bytes = Aes256Gcm::new_from_slice(key)
        .map_err(|_| Error::Authentication)?
        .decrypt(Nonce::from_slice(nonce), Payload { msg: data, aad })
        .map_err(|_| Error::Authentication)?;
    Ok(Zeroizing::new(bytes))
}
pub fn wrap(key: &[u8], value: &[u8]) -> Result<WrappedKey> {
    if value.len() != 32 {
        return Err(Error::Authentication);
    }
    let nonce = random::<12>();
    Ok(WrappedKey {
        nonce: encode(&nonce),
        ciphertext: encode(&encrypt(key, &nonce, value, &[])?),
    })
}
pub fn unwrap(key: &[u8], wrapped: &WrappedKey) -> Result<Secret> {
    let ct = decode(&wrapped.ciphertext)?;
    if ct.len() != 48 {
        return Err(Error::Authentication);
    }
    decrypt(key, &decode(&wrapped.nonce)?, &ct, &[])
}
pub fn decrypt_block(key: &[u8], file: &str, index: u64, stored: &[u8]) -> Result<Secret> {
    if stored.len() < 28 || stored.len() > 65536 + 28 {
        return Err(Error::Authentication);
    }
    let mut aad = file.as_bytes().to_vec();
    aad.extend(index.to_be_bytes());
    let mut ct = stored[28..].to_vec();
    ct.extend(&stored[12..28]);
    decrypt(key, &stored[..12], &ct, &aad)
}
