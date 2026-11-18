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
    pub score: f64,
}

/// One connection belongs to one workspace. IDs from another connection never
/// authorize access. SQLCipher is required; plain SQLite is a hard failure.
pub struct Store {
    db: Connection,
}
impl Store {
    pub fn open(path: &Path, key: &[u8], create: bool) -> Result<Self> {
        if key.len() != 32 {
            return Err(Error::Authentication);
        }
        let mut flags = OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX;
        if create {
            flags |= OpenFlags::SQLITE_OPEN_CREATE;
        }
        let db = Connection::open_with_flags(path, flags)?;
        let version: String = db.query_row("PRAGMA cipher_version", [], |r| r.get(0))?;
        if version.is_empty() {
            return Err(Error::Unsupported("SQLCipher is required".into()));
        }
        let key_sql = Zeroizing::new(format!("PRAGMA key=\"x'{}'\"", hex::encode(key)));
        db.execute_batch(&key_sql)?;
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
        let chunks = crate::chunking::chunk_pages(&[(1, text.to_string())]);
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
        let mut st = self.db.prepare("SELECT c.id,c.document_id,d.title,c.text,d.source_path,c.ordinal,c.page_from,c.page_to,-bm25(chunks_fts) FROM chunks_fts JOIN chunks c ON c.id=chunks_fts.rowid JOIN documents d ON d.id=c.document_id WHERE chunks_fts MATCH ?1 ORDER BY bm25(chunks_fts),c.id LIMIT ?2")?;
        let rows = st
            .query_map(params![terms, limit.clamp(1, 50) as i64], hit)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        ticket.check()?;
        Ok(rows)
    }
    pub fn source(&self, id: i64, ticket: &Ticket) -> Result<SourceHit> {
        ticket.check()?;
        let result = self.db.query_row("SELECT c.id,c.document_id,d.title,c.text,d.source_path,c.ordinal,c.page_from,c.page_to,0.0 FROM chunks c JOIN documents d ON d.id=c.document_id WHERE c.id=?1", [id], hit)?;
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
        score: r.get(8)?,
    })
}
