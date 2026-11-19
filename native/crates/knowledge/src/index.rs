use crate::{
    files::{Source, Vault},
    models::{ModelClient, Reranker},
};
use anyhow::{Result, ensure};
use fs2::FileExt;
use loklm_core::{
    chunking::chunk_markdown,
    retrieval::{RankedHit, fuse_rrf},
};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs::File,
    path::Path,
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hit {
    pub chunk_id: i64,
    pub source_id: String,
    pub source_hash: String,
    pub path: String,
    pub anchor: String,
    pub heading_path: Vec<String>,
    pub text: String,
    pub ordinal: usize,
    pub score: f64,
    pub open_uri: String,
    pub origin: String,
}
#[derive(Debug, Default, Clone, Serialize)]
pub struct Status {
    pub sources: usize,
    pub chunks: usize,
    pub embedded: usize,
    pub reused: usize,
    pub generation: usize,
    pub last_success_unix: Option<u64>,
}

pub struct Index {
    db: Mutex<Connection>,
    _lock: File,
    pub model: Option<ModelClient>,
    pub fingerprint: String,
    pub reranker: Option<Reranker>,
    pub answer: Option<crate::answer::AnswerClient>,
    acceleration_ready: AtomicBool,
    #[cfg(feature = "lance")]
    lance: Option<crate::lance::LanceStore>,
}
impl Index {
    pub fn sources(&self) -> Result<Vec<serde_json::Value>> {
        let db = self.db.lock().unwrap();
        let mut stmt =
            db.prepare("SELECT id,path,hash,links FROM sources ORDER BY path LIMIT 100000")?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })?;
        let mut sources=rows.map(|r|{let (id,path,hash,links)=r?;Ok(serde_json::json!({"source_id":id,"path":path,"content_hash":hash,"outgoing_wikilinks":serde_json::from_str::<Vec<String>>(&links)?,"backlinks":[],"unresolved_wikilinks":[]}))}).collect::<Result<Vec<_>>>()?;
        let paths: HashMap<String, String> = sources
            .iter()
            .map(|s| {
                (
                    s["path"].as_str().unwrap().to_owned(),
                    s["source_id"].as_str().unwrap().to_owned(),
                )
            })
            .collect();
        let mut names: HashMap<String, Option<String>> = HashMap::new();
        for (path, id) in &paths {
            names
                .entry(path.rsplit('/').next().unwrap().to_owned())
                .and_modify(|v| *v = None)
                .or_insert(Some(id.clone()));
        }
        let mut incoming: HashMap<String, HashSet<String>> = HashMap::new();
        let mut link_count = 0usize;
        for source in &mut sources {
            let current = source["path"].as_str().unwrap().to_owned();
            let id = source["source_id"].as_str().unwrap().to_owned();
            let mut unresolved = Vec::new();
            for link in source["outgoing_wikilinks"].as_array().unwrap() {
                link_count += 1;
                ensure!(link_count <= 100_000, "source link inventory exceeds bound");
                let raw = link.as_str().unwrap();
                let target = raw.split('#').next().unwrap_or("");
                let target = if target.is_empty() {
                    current.clone()
                } else if target.to_ascii_lowercase().ends_with(".md") {
                    target.to_owned()
                } else {
                    format!("{target}.md")
                };
                let matched = paths
                    .get(&target)
                    .or_else(|| {
                        current
                            .rsplit_once('/')
                            .and_then(|(parent, _)| paths.get(&format!("{parent}/{target}")))
                    })
                    .or_else(|| {
                        if target.contains('/') {
                            None
                        } else {
                            names.get(&target).and_then(Option::as_ref)
                        }
                    });
                if let Some(matched) = matched {
                    incoming
                        .entry(matched.clone())
                        .or_default()
                        .insert(id.clone());
                } else {
                    unresolved.push(raw.to_owned());
                }
            }
            source["unresolved_wikilinks"] = serde_json::json!(unresolved);
        }
        for source in &mut sources {
            let mut links: Vec<_> = incoming
                .remove(source["source_id"].as_str().unwrap())
                .unwrap_or_default()
                .into_iter()
                .collect();
            links.sort();
            source["backlinks"] = serde_json::json!(links);
        }
        Ok(sources)
    }
    pub async fn open(path: &Path, model: Option<ModelClient>) -> Result<Self> {
        std::fs::create_dir_all(path)?;
        let lock = File::options()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(path.join("owner.lock"))?;
        lock.try_lock_exclusive()
            .map_err(|_| anyhow::anyhow!("index already owned by another process"))?;
        let db = Connection::open(path.join("checkpoint.sqlite"))?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
          CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,path TEXT NOT NULL,hash TEXT NOT NULL,links TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS chunks(id INTEGER PRIMARY KEY AUTOINCREMENT,source TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,ordinal INTEGER NOT NULL,anchor TEXT NOT NULL,text TEXT NOT NULL,heading TEXT NOT NULL,vector TEXT,UNIQUE(source,anchor));
          CREATE VIRTUAL TABLE IF NOT EXISTS lexical USING fts5(text,content='chunks',content_rowid='id',tokenize='unicode61');
          CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN INSERT INTO lexical(rowid,text) VALUES(new.id,new.text); END;
          CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN INSERT INTO lexical(lexical,rowid,text) VALUES('delete',old.id,old.text); END;
          CREATE TABLE IF NOT EXISTS embeddings(fingerprint TEXT NOT NULL,hash TEXT NOT NULL,vector TEXT NOT NULL,PRIMARY KEY(fingerprint,hash));")?;
        let fingerprint = model
            .as_ref()
            .map(|m| m.fingerprint.clone())
            .unwrap_or_else(|| "lexical-only-v1".into());
        let chunker = loklm_core::chunking::CHUNKER_VERSION;
        let previous: Option<String> = db
            .query_row("SELECT value FROM meta WHERE key='chunker'", [], |r| {
                r.get(0)
            })
            .optional()?;
        ensure!(
            previous.as_ref().is_none_or(|x| x == chunker),
            "chunker changed: rebuild into a NEW index directory"
        );
        db.execute("INSERT OR IGNORE INTO meta VALUES('chunker',?1)", [chunker])?;
        let old: Option<String> = db
            .query_row("SELECT value FROM meta WHERE key='fingerprint'", [], |r| {
                r.get(0)
            })
            .optional()?;
        ensure!(
            old.as_ref().is_none_or(|x| x == &fingerprint),
            "model fingerprint changed: rebuild into a NEW index directory"
        );
        db.execute(
            "INSERT OR IGNORE INTO meta VALUES('fingerprint',?1)",
            [&fingerprint],
        )?;
        #[cfg(feature = "lance")]
        let lance = if model.is_some() {
            Some(crate::lance::LanceStore::open(&path.join("lance"), &fingerprint).await?)
        } else {
            None
        };
        Ok(Self {
            db: Mutex::new(db),
            _lock: lock,
            model,
            reranker: None,
            answer: None,
            acceleration_ready: AtomicBool::new(false),
            fingerprint,
            #[cfg(feature = "lance")]
            lance,
        })
    }
    pub fn status(&self) -> Result<Status> {
        let db = self.db.lock().unwrap();
        Ok(Status {
            sources: db.query_row("SELECT count(*) FROM sources", [], |r| r.get(0))?,
            chunks: db.query_row("SELECT count(*) FROM chunks", [], |r| r.get(0))?,
            generation: db
                .query_row(
                    "SELECT CAST(value AS INTEGER) FROM meta WHERE key='generation'",
                    [],
                    |r| r.get(0),
                )
                .optional()?
                .unwrap_or(0),
            last_success_unix: db
                .query_row(
                    "SELECT CAST(value AS INTEGER) FROM meta WHERE key='last_success'",
                    [],
                    |r| r.get(0),
                )
                .optional()?,
            embedded: db
                .query_row(
                    "SELECT CAST(value AS INTEGER) FROM meta WHERE key='last_embedded'",
                    [],
                    |r| r.get(0),
                )
                .optional()?
                .unwrap_or(0),
            reused: db
                .query_row(
                    "SELECT CAST(value AS INTEGER) FROM meta WHERE key='last_reused'",
                    [],
                    |r| r.get(0),
                )
                .optional()?
                .unwrap_or(0),
        })
    }
    pub async fn reconcile(&self, vault: &Vault, cancel: &CancellationToken) -> Result<Status> {
        if !self.acceleration_ready.load(Ordering::Acquire) {
            self.recover().await?;
        }
        let sources = vault.scan()?; // complete successful scan before deleting anything
        let existing: HashMap<String, String> = {
            let db = self.db.lock().unwrap();
            let mut s = db.prepare("SELECT id,hash FROM sources")?;
            s.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
                .collect::<std::result::Result<_, _>>()?
        };
        let mut status = Status::default();
        for source in &sources {
            ensure!(!cancel.is_cancelled(), "cancelled");
            if existing.get(&source.id) == Some(&source.hash) {
                self.db.lock().unwrap().execute(
                    "UPDATE sources SET path=?1 WHERE id=?2",
                    params![source.path, source.id],
                )?;
                continue;
            }
            self.ingest(source, vault, cancel, &mut status).await?;
        }
        ensure!(!cancel.is_cancelled(), "cancelled");
        let present: HashSet<_> = sources.iter().map(|s| &s.id).collect();
        let removed: Vec<_> = existing
            .keys()
            .filter(|k| !present.contains(k))
            .cloned()
            .collect();
        {
            let mut db = self.db.lock().unwrap();
            let tx = db.transaction()?;
            for id in &removed {
                tx.execute("DELETE FROM sources WHERE id=?1", [id])?;
            }
            tx.commit()?;
        }
        #[cfg(feature = "lance")]
        if let Some(lance) = &self.lance {
            self.acceleration_ready.store(false, Ordering::Release);
            for id in removed {
                lance.replace_source(&id, vec![]).await?;
            }
            self.acceleration_ready.store(true, Ordering::Release);
        }
        {
            let mut db = self.db.lock().unwrap();
            let tx = db.transaction()?;
            tx.execute("INSERT INTO meta VALUES('generation','1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1", [])?;
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs()
                .to_string();
            for (key, value) in [
                ("last_success", now),
                ("last_embedded", status.embedded.to_string()),
                ("last_reused", status.reused.to_string()),
            ] {
                tx.execute("INSERT INTO meta VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![key,value])?;
            }
            tx.commit()?;
        }
        self.status()
    }
    async fn ingest(
        &self,
        s: &Source,
        vault: &Vault,
        cancel: &CancellationToken,
        status: &mut Status,
    ) -> Result<()> {
        let chunks = chunk_markdown(&s.markdown);
        ensure!(chunks.len() <= 8192, "too many chunks");
        let mut vectors = Vec::new();
        for c in &chunks {
            let hash = crate::digest(loklm_core::models::sanitize_passage(&c.text));
            let cached: Option<String> = self
                .db
                .lock()
                .unwrap()
                .query_row(
                    "SELECT vector FROM embeddings WHERE fingerprint=?1 AND hash=?2",
                    params![self.fingerprint, hash],
                    |r| r.get(0),
                )
                .optional()?;
            let vector = if let Some(v) = cached {
                status.reused += 1;
                Some(serde_json::from_str::<Vec<f32>>(&v)?)
            } else if let Some(model) = &self.model {
                let mut batch = model.embed(&[c.text.clone()], false, cancel).await?;
                let v = batch.remove(0);
                self.db.lock().unwrap().execute(
                    "INSERT OR IGNORE INTO embeddings VALUES(?1,?2,?3)",
                    params![self.fingerprint, hash, serde_json::to_string(&v)?],
                )?;
                status.embedded += 1;
                Some(v)
            } else {
                None
            };
            vectors.push(vector);
        }
        ensure!(!cancel.is_cancelled(), "cancelled");
        ensure!(
            crate::digest(vault.read(&s.path)?) == s.hash,
            "source changed during indexing; retry"
        );
        // SQLite commits source, chunks, FTS and vectors in one durable transaction.
        // Lance is a rebuildable acceleration layer, never the canonical checkpoint.
        self.acceleration_ready.store(false, Ordering::Release);
        {
            let mut db = self.db.lock().unwrap();
            let tx = db.transaction()?;
            tx.execute("DELETE FROM sources WHERE id=?1", [&s.id])?;
            tx.execute(
                "INSERT INTO sources VALUES(?1,?2,?3,?4)",
                params![s.id, s.path, s.hash, serde_json::to_string(&s.backlinks)?],
            )?;
            let mut counts = HashMap::new();
            for (c, v) in chunks.iter().zip(&vectors) {
                let hash = crate::digest(format!("{:?}:{}", c.heading_path, c.text));
                let n = counts.entry(hash.clone()).or_insert(0);
                *n += 1;
                let anchor = format!("{}-{}", &hash[..24], n);
                tx.execute("INSERT INTO chunks(source,ordinal,anchor,text,heading,vector) VALUES(?1,?2,?3,?4,?5,?6)",params![s.id,c.ordinal,anchor,c.text,serde_json::to_string(&c.heading_path)?,v.as_ref().map(serde_json::to_string).transpose()?])?;
            }
            tx.commit()?;
        }
        #[cfg(feature = "lance")]
        if let Some(lance) = &self.lance {
            lance
                .replace_source(&s.id, self.vector_rows(Some(&s.id))?)
                .await?;
        }
        self.acceleration_ready.store(true, Ordering::Release);
        Ok(())
    }
    pub fn vector_rows(&self, source: Option<&str>) -> Result<Vec<(i64, String, Vec<f32>)>> {
        let db = self.db.lock().unwrap();
        let mut s=db.prepare("SELECT id,source,vector FROM chunks WHERE vector IS NOT NULL AND (?1 IS NULL OR source=?1)")?;
        let rows = s
            .query_map([source], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        rows.into_iter()
            .map(|(id, s, v)| Ok((id, s, serde_json::from_str(&v)?)))
            .collect()
    }
    pub async fn recover(&self) -> Result<()> {
        #[cfg(feature = "lance")]
        if let Some(lance) = &self.lance {
            lance.rebuild(self.vector_rows(None)?).await?;
        }
        self.acceleration_ready.store(true, Ordering::Release);
        Ok(())
    }
    pub async fn search(
        &self,
        query: &str,
        scope: &[String],
        limit: usize,
        cancel: &CancellationToken,
    ) -> Result<Vec<Hit>> {
        ensure!(
            !query.trim().is_empty()
                && query.len() <= 4096
                && limit > 0
                && limit <= 50
                && scope.len() <= 256,
            "invalid search bounds"
        );
        let tokens: Vec<_> = query
            .split(|c: char| !c.is_alphanumeric())
            .filter(|s| !s.is_empty())
            .take(32)
            .map(|t| format!("\"{t}\"*"))
            .collect();
        ensure!(!tokens.is_empty(), "empty lexical query");
        let scope_json = serde_json::to_string(scope)?;
        let lexical = {
            let db = self.db.lock().unwrap();
            let mut s=db.prepare("SELECT c.id,-bm25(lexical) FROM lexical JOIN chunks c ON c.id=lexical.rowid WHERE lexical MATCH ?1 AND (?2='[]' OR c.source IN (SELECT value FROM json_each(?2))) ORDER BY bm25(lexical),c.id LIMIT 100")?;
            s.query_map(params![tokens.join(" OR "), scope_json], |r| {
                Ok(RankedHit {
                    chunk_id: r.get(0)?,
                    score: r.get(1)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?
        };
        let mut lists = vec![(lexical, 1.0)];
        if let Some(m) = &self.model {
            ensure!(
                self.acceleration_ready.load(Ordering::Acquire),
                "index acceleration needs recovery"
            );
            let q = m.embed(&[query.to_string()], true, cancel).await?.remove(0);
            #[cfg(feature = "lance")]
            let dense = if let Some(lance) = &self.lance {
                lance.search(&q, scope, 100).await?
            } else {
                Vec::new()
            };
            #[cfg(not(feature = "lance"))]
            let dense = {
                let mut hits: Vec<_> = self
                    .vector_rows(None)?
                    .into_iter()
                    .filter(|(_, s, _)| scope.is_empty() || scope.contains(s))
                    .map(|(id, _, v)| RankedHit {
                        chunk_id: id,
                        score: v.iter().zip(&q).map(|(a, b)| f64::from(a * b)).sum(),
                    })
                    .collect();
                hits.sort_by(|a, b| b.score.total_cmp(&a.score));
                hits.truncate(100);
                hits
            };
            lists.push((dense, 1.0));
        }
        ensure!(!cancel.is_cancelled(), "cancelled");
        let ranked = fuse_rrf(&lists, 100);
        let mut candidates = Vec::new();
        {
            let db = self.db.lock().unwrap();
            for h in ranked {
                let row=db.query_row("SELECT c.id,c.source,s.path,c.anchor,c.heading,c.text,c.ordinal,s.hash FROM chunks c JOIN sources s ON s.id=c.source WHERE c.id=?1",[h.chunk_id],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?,r.get::<_,usize>(6)?,r.get::<_,String>(7)?))).optional()?;
                if let Some((
                    chunk_id,
                    source_id,
                    path,
                    anchor,
                    heading,
                    text,
                    ordinal,
                    source_hash,
                )) = row
                {
                    if !scope.is_empty() && !scope.contains(&source_id) {
                        continue;
                    }
                    let heading_path: Option<Vec<String>> = serde_json::from_str(&heading)?;
                    let location = heading_path
                        .as_ref()
                        .and_then(|h| h.last())
                        .map(|h| format!("{path}#{h}"))
                        .unwrap_or_else(|| path.clone());
                    let open_uri = format!(
                        "obsidian://open?{}",
                        url::form_urlencoded::Serializer::new(String::new())
                            .append_pair("file", &location)
                            .finish()
                    );
                    candidates.push(Hit {
                        chunk_id,
                        source_id,
                        source_hash,
                        path,
                        anchor,
                        heading_path: heading_path.unwrap_or_default(),
                        text,
                        ordinal,
                        score: h.score,
                        open_uri,
                        origin: "primary".into(),
                    });
                }
            }
        }
        if let Some(reranker) = &self.reranker {
            let docs: Vec<_> = candidates.iter().map(|h| h.text.clone()).collect();
            if !docs.is_empty() {
                let scores = reranker.rank(query, &docs, cancel).await?;
                for (hit, score) in candidates.iter_mut().zip(scores) {
                    hit.score = score;
                }
                candidates.sort_by(|a, b| {
                    b.score
                        .total_cmp(&a.score)
                        .then(a.chunk_id.cmp(&b.chunk_id))
                });
            }
        }
        // LokLM round-robin diversity: first hit per source, then second, etc.
        let mut out = Vec::new();
        let mut round = 0;
        while out.len() < limit && round < 6 {
            let mut counts = HashMap::new();
            let before = out.len();
            for h in &candidates {
                let n = counts.entry(&h.source_id).or_insert(0);
                if *n == round && out.len() < limit {
                    out.push(h.clone());
                }
                *n += 1;
            }
            if out.len() == before {
                break;
            }
            round += 1;
        }
        // Same source-only expansion policy as LokLM: whole short notes, or ±1
        // neighbouring chunks. Expansion cannot add a source outside the primary
        // slate and is bounded by both characters and count.
        let primary = out.clone();
        let mut used: HashSet<i64> = out.iter().map(|h| h.chunk_id).collect();
        let mut budget: usize = out.iter().map(|h| h.text.len()).sum();
        let db = self.db.lock().unwrap();
        for hit in primary {
            let total: i64 = db.query_row(
                "SELECT count(*) FROM chunks WHERE source=?1",
                [&hit.source_id],
                |r| r.get(0),
            )?;
            let mut stmt=db.prepare("SELECT id,anchor,text,heading,ordinal FROM chunks WHERE source=?1 AND (?2<=8 OR ordinal BETWEEN ?3 AND ?4) ORDER BY ordinal")?;
            let rows = stmt.query_map(
                params![
                    hit.source_id,
                    total,
                    hit.ordinal.saturating_sub(1),
                    hit.ordinal + 1
                ],
                |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                        r.get::<_, usize>(4)?,
                    ))
                },
            )?;
            for row in rows {
                let (id, anchor, text, heading, ordinal) = row?;
                if used.contains(&id) || out.len() >= limit * 3 || budget + text.len() > 24000 {
                    continue;
                }
                budget += text.len();
                used.insert(id);
                let mut neighbor = hit.clone();
                neighbor.chunk_id = id;
                neighbor.anchor = anchor;
                neighbor.text = text;
                neighbor.ordinal = ordinal;
                neighbor.heading_path =
                    serde_json::from_str::<Option<Vec<String>>>(&heading)?.unwrap_or_default();
                neighbor.origin = if total <= 8 { "whole_doc" } else { "neighbour" }.into();
                let location = neighbor
                    .heading_path
                    .last()
                    .map(|h| format!("{}#{h}", neighbor.path))
                    .unwrap_or_else(|| neighbor.path.clone());
                neighbor.open_uri = format!(
                    "obsidian://open?{}",
                    url::form_urlencoded::Serializer::new(String::new())
                        .append_pair("file", &location)
                        .finish()
                );
                out.push(neighbor);
            }
        }
        Ok(out)
    }
}
