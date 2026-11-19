use crate::{Error, Result, session::Ticket};
use rusqlite::{Connection, OpenFlags, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;
use zeroize::Zeroizing;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Document {
    pub id: i64,
    pub title: String,
    pub source_path: String,
    pub chunk_count: i64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SourceHit {
    pub chunk_id: i64,
    pub document_id: i64,
    pub title: String,
    pub text: String,
    pub source_path: String,
    pub ordinal: i64,
    pub page_from: Option<i64>,
    pub page_to: Option<i64>,
    pub heading_path: Option<Vec<String>>,
    pub language: Option<String>,
    pub score: f64,
}

/// One connection belongs to one workspace. IDs from another connection never
/// authorize access. SQLCipher is required; plain SQLite is a hard failure.
pub struct Store {
    db: Connection,
}
impl Store {
    /// Versioned derived data in the encrypted database. Existing Lance files
    /// and legacy embedder identities are never rewritten or discarded.
    pub fn initialize_native_index(&self, ticket: &Ticket) -> Result<()> {
        ticket.check()?;
        self.db.execute_batch("CREATE TABLE IF NOT EXISTS native_vectors_v1 (chunk_id INTEGER NOT NULL REFERENCES chunks(id) ON DELETE CASCADE, fingerprint TEXT NOT NULL, content_sha256 TEXT NOT NULL, vector BLOB NOT NULL, PRIMARY KEY(chunk_id,fingerprint));")?;
        ticket.check()
    }
    pub fn pending_vectors(
        &self,
        fingerprint: &str,
        limit: usize,
        ticket: &Ticket,
    ) -> Result<Vec<SourceHit>> {
        ticket.check()?;
        let mut st=self.db.prepare("SELECT c.id,c.document_id,d.title,c.text,d.source_path,c.ordinal,c.page_from,c.page_to,c.heading_path,c.language,0.0 FROM chunks c JOIN documents d ON d.id=c.document_id LEFT JOIN native_vectors_v1 v ON v.chunk_id=c.id AND v.fingerprint=?1 WHERE v.chunk_id IS NULL ORDER BY c.id LIMIT ?2")?;
        let rows = st
            .query_map(params![fingerprint, limit.clamp(1, 1000) as i64], hit)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        ticket.check()?;
        Ok(rows)
    }
    pub fn put_vector(
        &mut self,
        chunk: i64,
        fingerprint: &str,
        vector: &[f32],
        ticket: &Ticket,
    ) -> Result<()> {
        ticket.check()?;
        if fingerprint.len() != 64 || !fingerprint.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(Error::Invalid("Invalid embedding fingerprint".into()));
        }
        let mut normalized = vector.to_vec();
        crate::models::normalize(&mut normalized, crate::models::EMBEDDING_DIM)?;
        let bytes: Vec<u8> = normalized.iter().flat_map(|v| v.to_le_bytes()).collect();
        let tx = self.db.transaction()?;
        let text: String =
            tx.query_row("SELECT text FROM chunks WHERE id=?1", [chunk], |r| r.get(0))?;
        let hash = hex::encode(Sha256::digest(text.as_bytes()));
        tx.execute("INSERT INTO native_vectors_v1(chunk_id,fingerprint,content_sha256,vector) VALUES(?1,?2,?3,?4) ON CONFLICT(chunk_id,fingerprint) DO UPDATE SET content_sha256=excluded.content_sha256,vector=excluded.vector",params![chunk,fingerprint,hash,bytes])?;
        ticket.check()?;
        tx.commit()?;
        ticket.check()
    }
    /// Exact bounded scan for the encrypted preview. This is not an ANN engine
    /// recommendation; Lance/Qdrant evaluation belongs to the measured rollout.
    pub fn dense(
        &self,
        query: &[f32],
        fingerprint: &str,
        limit: usize,
        ticket: &Ticket,
    ) -> Result<Vec<crate::retrieval::RankedHit>> {
        ticket.check()?;
        let mut query = query.to_vec();
        crate::models::normalize(&mut query, crate::models::EMBEDDING_DIM)?;
        let count: i64 = self.db.query_row(
            "SELECT count(*) FROM native_vectors_v1 WHERE fingerprint=?1",
            [fingerprint],
            |r| r.get(0),
        )?;
        if count > 50000 {
            return Err(Error::Unsupported(
                "Native preview exact scan is limited to 50000 chunks".into(),
            ));
        }
        let mut st=self.db.prepare("SELECT v.chunk_id,v.vector,v.content_sha256,c.text FROM native_vectors_v1 v JOIN chunks c ON c.id=v.chunk_id WHERE v.fingerprint=?1")?;
        let mut rows = st.query([fingerprint])?;
        let mut hits = Vec::new();
        while let Some(r) = rows.next()? {
            ticket.check()?;
            let bytes: Vec<u8> = r.get(1)?;
            let hash: String = r.get(2)?;
            let text: String = r.get(3)?;
            if hash != hex::encode(Sha256::digest(text.as_bytes())) {
                return Err(Error::Invalid(
                    "Derived index is stale; reindex is required".into(),
                ));
            }
            if bytes.len() != query.len() * 4 {
                return Err(Error::Invalid("Derived index dimension mismatch".into()));
            }
            let vector = bytes
                .chunks_exact(4)
                .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
                .collect::<Vec<_>>();
            if vector.iter().any(|v| !v.is_finite()) {
                return Err(Error::Invalid(
                    "Derived index contains invalid values".into(),
                ));
            }
            let score = query
                .iter()
                .zip(vector)
                .map(|(a, b)| f64::from(*a) * f64::from(b))
                .sum();
            hits.push(crate::retrieval::RankedHit {
                chunk_id: r.get(0)?,
                score,
            });
        }
        hits.sort_by(|a, b| {
            b.score
                .total_cmp(&a.score)
                .then(a.chunk_id.cmp(&b.chunk_id))
        });
        hits.truncate(limit.min(50));
        ticket.check()?;
        Ok(hits)
    }
    pub fn open(path: &Path, key: &[u8], create: bool) -> Result<Self> {
        if key.len() != 32 {
            return Err(Error::Authentication);
        }
        let mut flags = OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX;
        if create {
            flags |= OpenFlags::SQLITE_OPEN_CREATE;
        }
        let db = Connection::open_with_flags(path, flags)?;
        db.execute_batch("PRAGMA cipher='sqlcipher'")?;
        let key_hex = Zeroizing::new(hex::encode(key));
        let key_sql = Zeroizing::new(format!("PRAGMA key=\"x'{}'\"", key_hex.as_str()));
        db.execute_batch(&key_sql)?;
        let version: String = db.query_row("SELECT sqlite3mc_version()", [], |r| r.get(0))?;
        if version != "SQLite3 Multiple Ciphers 2.3.4" {
            return Err(Error::Unsupported(format!(
                "Pinned SQLite3mc 2.3.4 is required (found {version})"
            )));
        }
        db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON; PRAGMA temp_store=MEMORY; PRAGMA cipher_memory_security=ON;")?;
        db.query_row("SELECT count(*) FROM sqlite_master", [], |r| {
            r.get::<_, i64>(0)
        })?;
        if create {
            db.execute_batch(include_str!("schema.sql"))?;
        }
        Ok(Self { db })
    }
    pub fn list(&self, ticket: &Ticket) -> Result<Vec<Document>> {
        ticket.check()?;
        let mut st = self
            .db
            .prepare("SELECT id,title,source_path,chunk_count FROM documents ORDER BY id")?;
        let rows = st
            .query_map([], |r| {
                Ok(Document {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    source_path: r.get(2)?,
                    chunk_count: r.get(3)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        ticket.check()?;
        Ok(rows)
    }
    pub fn import_text(
        &mut self,
        path: &str,
        title: &str,
        text: &str,
        ticket: &Ticket,
    ) -> Result<i64> {
        ticket.check()?;
        if text.len() > 16 * 1024 * 1024 || text.trim().is_empty() {
            return Err(Error::Invalid(
                "Empty document or larger than 16 MiB".into(),
            ));
        }
        let hash = hex::encode(Sha256::digest(text.as_bytes()));
        let existing: Option<(i64, Option<String>)> = self
            .db
            .query_row(
                "SELECT id,content_hash FROM documents WHERE source_path=?1",
                [path],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((id, old_hash)) = existing {
            if old_hash.as_deref() == Some(&hash) {
                return Ok(id);
            }
            return Err(Error::Invalid("Source changed; previous revision and citations are preserved. Revision import is not available yet".into()));
        }
        let chunks =
            if path.to_lowercase().ends_with(".md") || path.to_lowercase().ends_with(".markdown") {
                crate::chunking::chunk_markdown(text)
            } else {
                crate::chunking::chunk_pages(&[(1, text.to_string())])
            };
        let tx = self.db.transaction()?;
        tx.execute("INSERT INTO documents(title,source_path,mime_type,byte_size,status,chunk_count,content_hash) VALUES(?1,?2,'text/plain',?3,'ready',?4,?5)", params![title,path,text.len() as i64,chunks.len() as i64,hash])?;
        let id = tx.last_insert_rowid();
        for c in chunks {
            ticket.check()?;
            tx.execute("INSERT INTO chunks(document_id,ordinal,text,token_count,page_from,page_to,heading_path,embedder_identity) VALUES(?1,?2,?3,?4,?5,?6,?7,'pending:bundled:bge-m3')", params![id,c.ordinal,c.text,(c.text.chars().count() as f64 / 4.0).ceil() as i64,c.page_from,c.page_to,serde_json::to_string(&c.heading_path)?])?;
        }
        ticket.check()?;
        tx.commit()?;
        ticket.check()?;
        Ok(id)
    }
    pub fn search(&self, query: &str, limit: usize, ticket: &Ticket) -> Result<Vec<SourceHit>> {
        ticket.check()?;
        if query.len() > 4096 {
            return Err(Error::Invalid("Query too long".into()));
        }
        let terms = query
            .split(|c: char| !c.is_alphanumeric())
            .filter(|s| s.chars().count() > 1)
            .take(64)
            .map(|s| format!("\"{s}\""))
            .collect::<Vec<_>>()
            .join(" OR ");
        if terms.is_empty() {
            return Ok(vec![]);
        }
        let mut st = self.db.prepare("SELECT c.id,c.document_id,d.title,c.text,d.source_path,c.ordinal,c.page_from,c.page_to,c.heading_path,c.language,-bm25(chunks_fts) FROM chunks_fts JOIN chunks c ON c.id=chunks_fts.rowid JOIN documents d ON d.id=c.document_id WHERE chunks_fts MATCH ?1 ORDER BY bm25(chunks_fts),c.id LIMIT ?2")?;
        let rows = st
            .query_map(params![terms, limit.clamp(1, 50) as i64], hit)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        ticket.check()?;
        Ok(rows)
    }
    pub fn source(&self, id: i64, ticket: &Ticket) -> Result<SourceHit> {
        ticket.check()?;
        let result = self.db.query_row("SELECT c.id,c.document_id,d.title,c.text,d.source_path,c.ordinal,c.page_from,c.page_to,c.heading_path,c.language,0.0 FROM chunks c JOIN documents d ON d.id=c.document_id WHERE c.id=?1", [id], hit)?;
        ticket.check()?;
        Ok(result)
    }
}
fn hit(r: &rusqlite::Row<'_>) -> rusqlite::Result<SourceHit> {
    Ok(SourceHit {
        chunk_id: r.get(0)?,
        document_id: r.get(1)?,
        title: r.get(2)?,
        text: r.get(3)?,
        source_path: r.get(4)?,
        ordinal: r.get(5)?,
        page_from: r.get(6)?,
        page_to: r.get(7)?,
        heading_path: r
            .get::<_, Option<String>>(8)?
            .map(|s| serde_json::from_str(&s))
            .transpose()
            .map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(
                    8,
                    rusqlite::types::Type::Text,
                    Box::new(e),
                )
            })?
            .flatten(),
        language: r.get(9)?,
        score: r.get(10)?,
    })
}
