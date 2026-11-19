use anyhow::{Result, ensure};
use clap::{Parser, Subcommand};
use loklm_knowledge::{
    files::Vault,
    index::Index,
    models::{ModelClient, Profile, Reranker},
    service::{App, router},
};
use notify::Watcher;
use std::{path::PathBuf, time::Duration};

#[derive(Parser)]
#[command(version, about = "LokLM portable file knowledge daemon")]
struct Args {
    #[arg(long, env = "LOKLM_VAULT")]
    vault: PathBuf,
    #[arg(long, env = "LOKLM_INDEX")]
    index: PathBuf,
    #[arg(long, env = "LOKLM_BIND", default_value = "127.0.0.1:8787")]
    bind: String,
    #[arg(long, env = "LOKLM_PROFILE", default_value = "standard")]
    profile: Profile,
    #[arg(long, env = "LOKLM_EMBED_ENDPOINT")]
    embed_endpoint: Option<String>,
    #[arg(long, env = "LOKLM_MODEL_RUNTIME", default_value = "")]
    model_runtime: String,
    #[arg(long, env = "LOKLM_RERANK_ENDPOINT")]
    rerank_endpoint: Option<String>,
    #[arg(long, env = "LOKLM_ANSWER_ENDPOINT")]
    answer_endpoint: Option<String>,
    #[command(subcommand)]
    command: Command,
}
#[derive(Subcommand)]
enum Command {
    Serve,
    Reconcile,
    Import {
        #[arg(long)]
        path: String,
        #[arg(long)]
        from: PathBuf,
    },
    Fingerprint,
    RerankerFingerprint,
    AnswerFingerprint,
}
#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    if matches!(args.command, Command::AnswerFingerprint) {
        println!(
            "{}",
            loklm_knowledge::answer::AnswerClient::new("http://localhost/", &args.model_runtime)?
                .fingerprint
        );
        return Ok(());
    }
    if matches!(args.command, Command::RerankerFingerprint) {
        println!(
            "{}",
            Reranker::new("http://localhost/", &args.model_runtime)?.fingerprint
        );
        return Ok(());
    }
    if matches!(args.command, Command::Fingerprint) {
        let model = ModelClient::new("http://localhost/", args.profile, &args.model_runtime)?;
        println!("{}", model.fingerprint);
        return Ok(());
    }
    let vault = Vault::open(&args.vault)?;
    if let Command::Import { path, from } = args.command {
        println!("{}", vault.import(&path, &std::fs::read_to_string(from)?)?);
        return Ok(());
    }
    std::fs::create_dir_all(&args.index)?;
    let index_path = args.index.canonicalize()?;
    ensure!(
        !index_path.starts_with(vault.root()) && !vault.root().starts_with(&index_path),
        "vault and derived index must be separate sibling volumes"
    );
    let model = args
        .embed_endpoint
        .filter(|s| !s.is_empty())
        .map(|url| ModelClient::new(&url, args.profile, &args.model_runtime))
        .transpose()?;
    let mut index = Index::open(&index_path, model).await?;
    index.answer = args
        .answer_endpoint
        .filter(|s| !s.is_empty())
        .map(|url| loklm_knowledge::answer::AnswerClient::new(&url, &args.model_runtime))
        .transpose()?;
    index.reranker = args
        .rerank_endpoint
        .filter(|s| !s.is_empty())
        .map(|url| Reranker::new(&url, &args.model_runtime))
        .transpose()?;
    index.recover().await?;
    if matches!(args.command, Command::Reconcile) {
        println!(
            "{}",
            serde_json::to_string(
                &index
                    .reconcile(&vault, &tokio_util::sync::CancellationToken::new())
                    .await?
            )?
        );
        return Ok(());
    }
    let token_path = std::env::var("LOKLM_TOKEN_FILE")
        .map_err(|_| anyhow::anyhow!("set LOKLM_TOKEN_FILE to private API token file"))?;
    let token = std::fs::read_to_string(token_path)?.trim().to_string();
    ensure!(
        token.len() >= 32,
        "API token must be at least 32 characters"
    );
    let app = App::new(index, vault, token);
    // Coalescing one-slot watcher queue, 750 ms debounce and 30s periodic full
    // reconciliation. Watch overflow/errors still trigger a bounded full scan.
    let (send, mut receive) = tokio::sync::mpsc::channel::<()>(1);
    let mut watcher = notify::recommended_watcher(move |_| {
        let _ = send.try_send(());
    })?;
    watcher.watch(app.vault.root(), notify::RecursiveMode::Recursive)?;
    let worker = app.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {_ = worker.cancel.cancelled()=>break,_=interval.tick()=>{},_=receive.recv()=>{tokio::time::sleep(Duration::from_millis(750)).await;}}
            if worker.reconcile().await.is_err() {
                eprintln!("reconciliation failed; canonical files unchanged");
            }
        }
    });
    let listener = tokio::net::TcpListener::bind(args.bind).await?;
    axum::serve(listener, router(app.clone()))
        .with_graceful_shutdown(async move {
            #[cfg(unix)]
            {
                let mut terminate =
                    tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                        .expect("SIGTERM handler");
                tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = terminate.recv() => {} }
            }
            #[cfg(not(unix))]
            let _ = tokio::signal::ctrl_c().await;
            app.cancel.cancel();
        })
        .await?;
    drop(watcher);
    Ok(())
}
