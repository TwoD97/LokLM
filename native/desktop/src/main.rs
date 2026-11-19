#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use loklm_core::{
    Error, Result,
    session::{Sessions, Ticket},
    store::Store,
    vault::Vault,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    io::Read,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;
use zeroize::Zeroizing;

struct Live {
    vault: Option<Vault>,
    store: Option<Store>,
    workspace: Option<u64>,
    last_activity: Instant,
    failures: Vec<Instant>,
    generator: Option<loklm_inference::Model>,
    embedder: Option<loklm_inference::Model>,
    reranker: Option<loklm_inference::Model>,
}
struct Runtime {
    root: PathBuf,
    sessions: Sessions,
    live: Mutex<Live>,
    active: Mutex<Option<Ticket>>,
    cancellations: AtomicU64,
    pending_auth: AtomicUsize,
}
struct AuthGuard(Arc<Runtime>);
impl Drop for AuthGuard {
    fn drop(&mut self) {
        self.0.pending_auth.fetch_sub(1, Ordering::SeqCst);
    }
}
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
enum Request {
    Status,
    Register {
        name: String,
        password: String,
    },
    Unlock {
        password: String,
    },
    Recover {
        phrase: String,
        password: String,
    },
    Lock,
    CreateWorkspace {
        name: String,
    },
    SelectWorkspace {
        id: u64,
    },
    Import,
    Search {
        query: String,
    },
    Source {
        chunk_id: i64,
        workspace: u64,
    },
    Cancel,
    Close,
    LoadModel {
        kind: String,
    },
    UnloadModels,
    Index,
    Ask {
        query: String,
        language: loklm_core::qa::Language,
        stream: tauri::ipc::JavaScriptChannelId,
    },
}
impl Runtime {
    fn status(&self, live: &Live) -> Value {
        let workspaces = live
            .vault
            .as_ref()
            .map(|v| {
                v.body["manifest"]["workspaces"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|e| json!({"id":e["id"],"name":e["name"]}))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        json!({"registered":self.root.join("loklm.vault").exists(),"unlocked":live.vault.is_some(),"workspace":live.workspace,"workspaces":workspaces,"epoch":self.sessions.epoch(),"backup":live.vault.as_ref().is_some_and(|v|v.loaded_from_backup)})
    }
    fn open_workspace(&self, live: &mut Live, id: u64) -> Result<()> {
        let vault = live.vault.as_ref().ok_or(Error::Revoked)?;
        let (dir, key) = vault.workspace_key(id)?;
        let root = self.root.join("workspaces");
        std::fs::create_dir_all(&root)?;
        if !std::fs::canonicalize(&root)?.starts_with(std::fs::canonicalize(&self.root)?) {
            return Err(Error::Revoked);
        }
        let path = root.join(dir);
        std::fs::create_dir_all(&path)?;
        // Refuse redirected directories (including junctions) escaping the scope.
        let path = std::fs::canonicalize(path)?;
        let scope = std::fs::canonicalize(root)?;
        if !path.starts_with(&scope) {
            return Err(Error::Revoked);
        }
        let file = path.join("meta.db");
        if file.exists() && !std::fs::canonicalize(&file)?.starts_with(&scope) {
            return Err(Error::Revoked);
        }
        let store = Store::open(&file, &key, !file.exists())?;
        live.store = Some(store);
        live.workspace = Some(id);
        Ok(())
    }
    fn perform(
        &self,
        request: Request,
        app: &tauri::AppHandle,
        admitted: u64,
        auth_epoch: u64,
    ) -> Result<Value> {
        let mut live = self.live.lock().map_err(|_| Error::Revoked)?;
        if !matches!(request, Request::Lock)
            && self.cancellations.load(Ordering::SeqCst) != admitted
        {
            return Err(Error::Revoked);
        }
        match request {
            Request::Status => Ok(self.status(&live)),
            Request::Lock => {
                live.generator = None;
                live.embedder = None;
                live.reranker = None;
                live.store = None;
                live.workspace = None;
                live.vault = None;
                Ok(self.status(&live))
            }
            Request::Cancel => Ok(json!({"cancelled":true})),
            Request::Register { name, password } => {
                let password = Zeroizing::new(password);
                if live.vault.is_some()
                    || self.root.join("loklm.vault").exists()
                    || self.root.join("loklm.vault.bak").exists()
                {
                    return Err(Error::Invalid("A vault already exists".into()));
                }
                let epoch = auth_epoch;
                let recovery = Zeroizing::new(Vault::new_recovery_phrase());
                let vault = Vault::create(&name, password.as_bytes(), recovery.as_bytes())?;
                if epoch != self.sessions.epoch() {
                    return Err(Error::Revoked);
                }
                vault.persist(&self.root.join("loklm.vault"))?;
                self.sessions.publish(epoch)?;
                live.vault = Some(vault);
                live.last_activity = Instant::now();
                Ok(json!({"status":self.status(&live),"recovery":recovery.as_str()}))
            }
            Request::Unlock { password } => {
                let password = Zeroizing::new(password);
                if live.vault.is_some() {
                    return Err(Error::Invalid("Already unlocked".into()));
                }
                live.failures
                    .retain(|t| t.elapsed() < Duration::from_secs(300));
                if live.failures.len() >= 5 {
                    return Err(Error::Invalid(
                        "Too many attempts; wait five minutes".into(),
                    ));
                }
                let epoch = auth_epoch;
                let vault = match Vault::open(&self.root.join("loklm.vault"), password.as_bytes()) {
                    Ok(v) => v,
                    Err(e) => {
                        live.failures.push(Instant::now());
                        return Err(e);
                    }
                };
                self.sessions.publish(epoch)?;
                live.vault = Some(vault);
                live.failures.clear();
                live.last_activity = Instant::now();
                Ok(json!({"status":self.status(&live)}))
            }
            Request::Recover { phrase, password } => {
                let phrase = Zeroizing::new(phrase);
                let password = Zeroizing::new(password);
                if live.vault.is_some() {
                    return Err(Error::Invalid("Lock before recovery".into()));
                }
                live.failures
                    .retain(|t| t.elapsed() < Duration::from_secs(300));
                if live.failures.len() >= 5 {
                    return Err(Error::Invalid(
                        "Too many attempts; wait five minutes".into(),
                    ));
                }
                let epoch = auth_epoch;
                let (vault, recovery) = match Vault::reset_copy(
                    &self.root.join("loklm.vault"),
                    phrase.as_bytes(),
                    password.as_bytes(),
                ) {
                    Ok(v) => v,
                    Err(e) => {
                        live.failures.push(Instant::now());
                        return Err(e);
                    }
                };
                let recovery = Zeroizing::new(recovery);
                if epoch != self.sessions.epoch() {
                    return Err(Error::Revoked);
                }
                vault.persist(&self.root.join("loklm.vault"))?;
                self.sessions.publish(epoch)?;
                live.vault = Some(vault);
                live.failures.clear();
                live.last_activity = Instant::now();
                Ok(json!({"status":self.status(&live),"recovery":recovery.as_str()}))
            }
            request => {
                let ticket = self.sessions.ticket()?;
                *self.active.lock().map_err(|_| Error::Revoked)? = Some(ticket.clone());
                live.last_activity = Instant::now();
                let result = (|| {
                    if self.cancellations.load(Ordering::SeqCst) != admitted {
                        return Err(Error::Revoked);
                    }
                    match request {
                        Request::CreateWorkspace { name } => {
                            let old = live.vault.as_ref().ok_or(Error::Revoked)?.body.clone();
                            let id = live.vault.as_mut().unwrap().add_workspace(&name)?;
                            if let Err(e) = ticket
                                .check()
                                .and_then(|_| self.open_workspace(&mut live, id))
                                .and_then(|_| {
                                    live.vault
                                        .as_ref()
                                        .unwrap()
                                        .persist(&self.root.join("loklm.vault"))
                                })
                            {
                                live.vault.as_mut().unwrap().body = old;
                                live.store = None;
                                live.workspace = None;
                                return Err(e);
                            }
                            Ok(json!({"status":self.status(&live),"documents":[]}))
                        }
                        Request::SelectWorkspace { id } => {
                            self.open_workspace(&mut live, id)?;
                            Ok(
                                json!({"status":self.status(&live),"documents":live.store.as_ref().unwrap().list(&ticket)?}),
                            )
                        }
                        Request::Import => {
                            if live.store.is_none() {
                                return Err(Error::Invalid("Select a workspace".into()));
                            }
                            #[cfg(feature = "ui-test")]
                            let fixture =
                                std::env::var_os("LOKLM_NATIVE_TEST_PICK_FILE").map(PathBuf::from);
                            #[cfg(not(feature = "ui-test"))]
                            let fixture: Option<PathBuf> = None;
                            let picked = if let Some(path) = fixture {
                                let test_root = self.root.parent().ok_or(Error::Revoked)?;
                                if !test_root
                                    .file_name()
                                    .is_some_and(|n| n.to_string_lossy().starts_with("native-ui-"))
                                    || !std::fs::canonicalize(&path)?
                                        .starts_with(std::fs::canonicalize(test_root)?)
                                {
                                    return Err(Error::Revoked);
                                }
                                Some(path)
                            } else {
                                app.dialog()
                                    .file()
                                    .add_filter(
                                        "Text, Markdown, PDF and DOCX",
                                        &["txt", "md", "markdown", "pdf", "docx"],
                                    )
                                    .blocking_pick_file()
                                    .map(|p| p.into_path())
                                    .transpose()
                                    .map_err(|_| Error::Invalid("File path".into()))?
                            };
                            ticket.check()?;
                            if let Some(picked) = picked {
                                let path = picked;
                                let extension = path
                                    .extension()
                                    .and_then(|s| s.to_str())
                                    .unwrap_or("")
                                    .to_lowercase();
                                if !["txt", "md", "markdown", "pdf", "docx"]
                                    .contains(&extension.as_str())
                                {
                                    return Err(Error::Unsupported(
                                        "Select text, Markdown, text-layer PDF or DOCX".into(),
                                    ));
                                }
                                let file = std::fs::File::open(&path)?;
                                let mut bytes = Zeroizing::new(Vec::new());
                                file.take(16 * 1024 * 1024 + 1).read_to_end(&mut bytes)?;
                                if bytes.len() > 16 * 1024 * 1024 {
                                    return Err(Error::Invalid(
                                        "Maximum import size is 16 MiB".into(),
                                    ));
                                }
                                ticket.check()?;
                                let title = path.file_name().unwrap_or_default().to_string_lossy();
                                if extension == "pdf" {
                                    use sha2::{Digest, Sha256};
                                    let parsed = loklm_documents::parse_isolated(&bytes, &ticket)?;
                                    let chunks = loklm_core::chunking::chunk_pages(&parsed.pages);
                                    live.store.as_mut().unwrap().import_chunks(
                                        &path.to_string_lossy(),
                                        &title,
                                        "application/pdf",
                                        bytes.len(),
                                        &hex::encode(Sha256::digest(&bytes)),
                                        &chunks,
                                        &ticket,
                                    )?;
                                } else if extension == "docx" {
                                    use sha2::{Digest, Sha256};
                                    let parsed =
                                        loklm_documents::parse_docx_isolated(&bytes, &ticket)?;
                                    let sections = parsed
                                        .sections
                                        .into_iter()
                                        .map(|s| loklm_core::chunking::MarkdownSection {
                                            heading_path: s.heading_path,
                                            text: s.text,
                                        })
                                        .collect::<Vec<_>>();
                                    let chunks =
                                        loklm_core::chunking::chunk_markdown_sections(&sections);
                                    live.store.as_mut().unwrap().import_chunks(
                                        &path.to_string_lossy(), &title,
                                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                                        bytes.len(), &hex::encode(Sha256::digest(&bytes)), &chunks, &ticket,
                                    )?;
                                } else {
                                    let text = std::str::from_utf8(&bytes).map_err(|_| {
                                        Error::Invalid("Source must be UTF-8".into())
                                    })?;
                                    live.store.as_mut().unwrap().import_text(
                                        &path.to_string_lossy(),
                                        &title,
                                        text,
                                        &ticket,
                                    )?;
                                }
                            }
                            Ok(json!({"documents":live.store.as_ref().unwrap().list(&ticket)?}))
                        }
                        Request::Search { query } => {
                            let hits = live
                                .store
                                .as_ref()
                                .ok_or(Error::Invalid("Select a workspace".into()))?
                                .search(&query, 8, &ticket)?;
                            Ok(json!({"hits":hits,"mode":"lexical","epoch":ticket.epoch()}))
                        }
                        Request::LoadModel { kind } => {
                            let (kind, filename) = match kind.as_str() {
                                "generator" => {
                                    (loklm_inference::ModelKind::Qwen4B, "Qwen3.5-4B-Q4_K_M.gguf")
                                }
                                "bge" => (loklm_inference::ModelKind::BgeM3, "bge-m3-Q4_K_M.gguf"),
                                "qwen_embedding" => (
                                    loklm_inference::ModelKind::Qwen3Embedding,
                                    "Qwen3-Embedding-0.6B-Q8_0.gguf",
                                ),
                                "reranker" => (
                                    loklm_inference::ModelKind::BgeReranker,
                                    "bge-reranker-v2-m3-Q4_K_M.gguf",
                                ),
                                _ => return Err(Error::Invalid("Unknown model profile".into())),
                            };
                            #[cfg(feature = "ui-test")]
                            let fixture = std::env::var_os("LOKLM_NATIVE_TEST_MODELS_DIR")
                                .filter(|p| !p.is_empty())
                                .map(|p| PathBuf::from(p).join(filename));
                            #[cfg(not(feature = "ui-test"))]
                            let fixture: Option<PathBuf> = None;
                            let path = match fixture {
                                Some(p) => Some(p),
                                None => app
                                    .dialog()
                                    .file()
                                    .set_title(format!("Select {filename}"))
                                    .add_filter("GGUF", &["gguf"])
                                    .blocking_pick_file()
                                    .map(|p| p.into_path())
                                    .transpose()
                                    .map_err(|_| Error::Invalid("Model path".into()))?,
                            };
                            if let Some(path) = path {
                                // Release only our own idle slot; no shared service is contacted.
                                if matches!(kind, loklm_inference::ModelKind::Qwen4B) {
                                    live.generator = None;
                                } else if matches!(kind, loklm_inference::ModelKind::BgeReranker) {
                                    live.reranker = None;
                                } else {
                                    live.embedder = None;
                                }
                                let model = loklm_inference::Model::load(&path, kind, &ticket)?;
                                if matches!(kind, loklm_inference::ModelKind::Qwen4B) {
                                    live.generator = Some(model);
                                } else if matches!(kind, loklm_inference::ModelKind::BgeReranker) {
                                    live.reranker = Some(model);
                                } else {
                                    live.embedder = Some(model);
                                }
                            } else {
                                return Ok(json!({"message":"Model selection cancelled"}));
                            }
                            Ok(
                                json!({"message":"Model ready on CPU (2 threads)","generator":live.generator.is_some(),"embedder":live.embedder.is_some()}),
                            )
                        }
                        Request::UnloadModels => {
                            live.generator = None;
                            live.embedder = None;
                            live.reranker = None;
                            Ok(json!({"message":"Preview models unloaded"}))
                        }
                        Request::Index => {
                            let Live {
                                store, embedder, ..
                            } = &mut *live;
                            let model = embedder
                                .as_ref()
                                .ok_or(Error::Invalid("Load an embedding model first".into()))?;
                            let fingerprint = model.embedding_fingerprint(false)?;
                            let store = store
                                .as_mut()
                                .ok_or(Error::Invalid("Select a workspace".into()))?;
                            store.initialize_native_index(&ticket)?;
                            let mut count = 0;
                            loop {
                                let pending = store.pending_vectors(&fingerprint, 8, &ticket)?;
                                if pending.is_empty() {
                                    break;
                                }
                                for chunk in pending {
                                    let vector = model.embed(&chunk.text, false, false, &ticket)?;
                                    store.put_vector(
                                        chunk.chunk_id,
                                        &fingerprint,
                                        &vector,
                                        &ticket,
                                    )?;
                                    count += 1;
                                }
                            }
                            Ok(
                                json!({"message":format!("Indexed {count} passages. Completed chunks are restart checkpoints.")}),
                            )
                        }
                        Request::Ask {
                            query,
                            language,
                            stream,
                        } => {
                            let window = app.get_webview_window("main").ok_or(Error::Revoked)?;
                            let stream = stream.channel_on::<_, String>(window.as_ref().clone());
                            use loklm_core::{
                                qa,
                                retrieval::{RankedHit, fuse_rrf},
                            };
                            if query.trim().is_empty() || query.len() > 4096 {
                                return Err(Error::Invalid(
                                    "Question must contain 1–4096 bytes".into(),
                                ));
                            }
                            let store = live
                                .store
                                .as_ref()
                                .ok_or(Error::Invalid("Select a workspace".into()))?;
                            let lexical = store.search(&query, 16, &ticket)?;
                            let mut hits = lexical.clone();
                            let mut mode = "lexical";
                            if let Some(model) = &live.embedder {
                                let fingerprint = model.embedding_fingerprint(false)?;
                                store.initialize_native_index(&ticket)?;
                                if !store.pending_vectors(&fingerprint, 1, &ticket)?.is_empty() {
                                    return Err(Error::Invalid(
                                        "Index this workspace with the selected embedder first"
                                            .into(),
                                    ));
                                }
                                let vector = model.embed(&query, true, false, &ticket)?;
                                let dense = store.dense(&vector, &fingerprint, 16, &ticket)?;
                                // A dense-only score is not a calibrated relevance gate.
                                // Without a reranker require lexical overlap. Dense-only
                                // candidates can enter the real reranker when loaded.
                                if !lexical.is_empty() || live.reranker.is_some() {
                                    let lex = lexical
                                        .iter()
                                        .map(|h| RankedHit {
                                            chunk_id: h.chunk_id,
                                            score: h.score,
                                        })
                                        .collect();
                                    hits = fuse_rrf(&[(lex, 1.0), (dense, 1.0)], 12)
                                        .into_iter()
                                        .map(|h| store.source(h.chunk_id, &ticket))
                                        .collect::<Result<Vec<_>>>()?;
                                }
                                mode = "hybrid-preview-no-reranker";
                            }
                            if let Some(reranker) = &live.reranker
                                && !hits.is_empty()
                            {
                                let documents =
                                    hits.iter().map(|h| h.text.clone()).collect::<Vec<_>>();
                                let scores = reranker.rerank(&query, &documents, &ticket)?;
                                for (hit, score) in hits.iter_mut().zip(scores) {
                                    hit.score = score;
                                }
                                hits.sort_by(|a, b| {
                                    b.score
                                        .total_cmp(&a.score)
                                        .then(a.chunk_id.cmp(&b.chunk_id))
                                });
                                // Original CHAT_RELEVANCE_FLOOR, applied only to actual
                                // cross-encoder scores. Until checked QA is ported, a
                                // completely weak slate refuses instead of keeping one
                                // weak source for model-side refusal verification.
                                hits.retain(|h| h.score >= 0.2);
                                mode = "reranked-preview";
                            }
                            if hits.is_empty() {
                                return Ok(
                                    json!({"answer":qa::refusal(language),"hits":[],"mode":mode}),
                                );
                            }
                            let model = live.generator.as_ref().ok_or(Error::Invalid(
                                "Load the Qwen3.5-4B answer model first".into(),
                            ))?;
                            let candidates = hits
                                .iter()
                                .map(|h| qa::Passage {
                                    document_id: h.document_id,
                                    chunk_id: h.chunk_id,
                                    document_title: h.title.clone(),
                                    text: h.text.clone(),
                                    heading_path: h.heading_path.clone(),
                                    page_from: h.page_from.and_then(|p| p.try_into().ok()),
                                    page_to: h.page_to.and_then(|p| p.try_into().ok()),
                                    language: h.language.clone(),
                                    origin: None,
                                })
                                .collect::<Vec<_>>();
                            let system = qa::system_prompt(language, qa::Depth::Concise, false);
                            let output = qa::answer_max_tokens(8192);
                            let empty = qa::build_prompt(&query, &[], &[], language, &[], None);
                            let budget = 8192usize.saturating_sub(
                                output
                                    + qa::estimate_tokens(system)
                                    + qa::estimate_tokens(&empty)
                                    + qa::CONTEXT_PACK_MARGIN_TOKENS
                                    + 128,
                            );
                            let supplied = qa::pack_hits_to_budget(&candidates, budget, language);
                            if supplied.is_empty() {
                                return Err(Error::Invalid(
                                    "No complete passage fits the context window".into(),
                                ));
                            }
                            let prompt =
                                qa::build_prompt(&query, &supplied, &[], language, &[], None);
                            let answer =
                                model.generate(system, &prompt, output, &ticket, |text| {
                                    ticket.check()?;
                                    stream.send(text.to_owned()).map_err(|_| Error::Revoked)
                                })?;
                            let cited = qa::validate_citations(&answer, &supplied)?;
                            let citations =
                                loklm_core::citation_markers::find_citation_matches(&answer);
                            let sources = hits
                                .into_iter()
                                .filter(|h| {
                                    cited.iter().any(|c| {
                                        c.chunk_id == h.chunk_id && c.document_id == h.document_id
                                    })
                                })
                                .collect::<Vec<_>>();
                            Ok(
                                json!({"answer":answer,"citations":citations,"hits":sources,"mode":mode,"epoch":ticket.epoch()}),
                            )
                        }
                        Request::Source {
                            chunk_id,
                            workspace,
                        } => {
                            if live.workspace != Some(workspace) {
                                return Err(Error::Revoked);
                            }
                            Ok(
                                json!({"source":live.store.as_ref().ok_or(Error::Revoked)?.source(chunk_id,&ticket)?,"epoch":ticket.epoch()}),
                            )
                        }
                        _ => unreachable!(),
                    }
                })();
                *self.active.lock().map_err(|_| Error::Revoked)? = None;
                ticket.check()?;
                result
            }
        }
    }
}
#[tauri::command]
async fn dispatch(
    input: Request,
    state: State<'_, Arc<Runtime>>,
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> std::result::Result<Value, String> {
    if window.label() != "main" {
        return Err("Unauthorized window".into());
    }
    if matches!(input, Request::Close) {
        window
            .close()
            .map_err(|_| "Could not close window".to_string())?;
        return Ok(json!({"closing":true}));
    }
    if matches!(input, Request::Lock) {
        state.sessions.revoke();
    }
    if matches!(input, Request::Cancel | Request::Lock) {
        state.cancellations.fetch_add(1, Ordering::SeqCst);
        if state.pending_auth.load(Ordering::SeqCst) > 0 {
            state.sessions.revoke();
        }
        if let Ok(active) = state.active.lock()
            && let Some(t) = active.as_ref()
        {
            t.cancel();
        }
    }
    if matches!(input, Request::Cancel) {
        return Ok(json!({"cancelled":true}));
    }
    let state = state.inner().clone();
    let admitted = state.cancellations.load(Ordering::SeqCst);
    let auth_epoch = state.sessions.epoch();
    let auth = if matches!(
        input,
        Request::Register { .. } | Request::Unlock { .. } | Request::Recover { .. }
    ) {
        state.pending_auth.fetch_add(1, Ordering::SeqCst);
        Some(AuthGuard(state.clone()))
    } else {
        None
    };
    tauri::async_runtime::spawn_blocking(move || {
        let _auth = auth;
        state.perform(input, &app, admitted, auth_epoch)
    })
    .await
    .map_err(|_| "Operation stopped".to_string())?
    .map_err(|e| e.to_string())
}
fn main() {
    if std::env::args_os()
        .nth(1)
        .is_some_and(|a| a == loklm_documents::DOCX_WORKER_ARGUMENT)
    {
        std::process::exit(loklm_documents::docx_worker_main());
    }
    if std::env::args_os()
        .nth(1)
        .is_some_and(|a| a == loklm_documents::WORKER_ARGUMENT)
    {
        std::process::exit(loklm_documents::worker_main());
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Preview identifier and data root never discover or open Electron data.
            let root = std::env::var_os("LOKLM_NATIVE_DATA_DIR")
                .map(PathBuf::from)
                .unwrap_or(app.path().app_local_data_dir()?.join("preview-vault"));
            let runtime = Arc::new(Runtime {
                root,
                sessions: Sessions::default(),
                live: Mutex::new(Live {
                    vault: None,
                    store: None,
                    workspace: None,
                    last_activity: Instant::now(),
                    failures: vec![],
                    generator: None,
                    embedder: None,
                    reranker: None,
                }),
                active: Mutex::new(None),
                cancellations: AtomicU64::new(0),
                pending_auth: AtomicUsize::new(0),
            });
            app.manage(runtime.clone());
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(Duration::from_secs(5));
                    let expired = runtime
                        .live
                        .lock()
                        .map(|v| {
                            v.vault.is_some()
                                && v.last_activity.elapsed() >= Duration::from_secs(900)
                        })
                        .unwrap_or(true);
                    if expired {
                        runtime.sessions.revoke();
                        let _ = runtime.perform(
                            Request::Lock,
                            &handle,
                            runtime.cancellations.load(Ordering::SeqCst),
                            runtime.sessions.epoch(),
                        );
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                let runtime = window.state::<Arc<Runtime>>();
                runtime.sessions.revoke();
                if let Ok(mut live) = runtime.live.lock() {
                    live.store = None;
                    live.generator = None;
                    live.embedder = None;
                    live.reranker = None;
                    live.vault = None;
                    live.workspace = None;
                }
            }
        })
        .invoke_handler(tauri::generate_handler![dispatch])
        .run(tauri::generate_context!())
        .expect("LokLM native runtime failed");
}
