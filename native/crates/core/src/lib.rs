//! Platform-independent knowledge and encrypted storage core. No network listener.
pub mod chunking;
pub mod crypto;
pub mod models;
pub mod qa;
pub mod retrieval;
pub mod session;
pub mod source_calculations;
pub mod source_fragments;
pub mod source_quantities;
pub mod source_quote;
pub mod source_units;
#[cfg(feature = "storage")]
pub mod store;
#[cfg(feature = "storage")]
pub mod vault;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Vault is locked or the operation was cancelled")]
    Revoked,
    #[error("Authentication failed or encrypted data is damaged")]
    Authentication,
    #[error("Unsupported format: {0}; original data was not modified")]
    Unsupported(String),
    #[error("Invalid input: {0}")]
    Invalid(String),
    #[error("Storage operation failed")]
    Io(#[from] std::io::Error),
    #[error("Invalid data format")]
    Json(#[from] serde_json::Error),
    #[cfg(feature = "storage")]
    #[error("Database operation failed")]
    Db(#[from] rusqlite::Error),
}
pub type Result<T> = std::result::Result<T, Error>;
