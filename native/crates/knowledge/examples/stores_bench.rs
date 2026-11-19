//! Same precomputed LokLM embeddings, source filters and exact cosine target.
//! Never invokes a model; inference timings live in the input corpus separately.
use anyhow::{Result, ensure};
use loklm_knowledge::lance::LanceStore;
use qdrant_client::{
    Qdrant,
    qdrant::{
        Condition, CreateCollectionBuilder, DeletePointsBuilder, Distance, Filter, PointStruct,
        QueryPointsBuilder, UpsertPointsBuilder, VectorParamsBuilder, point_id::PointIdOptions,
    },
};
use serde::Deserialize;
use serde_json::json;
use std::{collections::HashSet, path::PathBuf, time::Instant};

#[derive(Clone, Deserialize)]
struct Row {
    id: i64,
    source: String,
    vector: Vec<f32>,
}
#[derive(Deserialize)]
struct Query {
    expected_source: String,
    vector: Vec<f32>,
}
#[derive(Deserialize)]
struct Corpus {
    model_fingerprint: String,
    rows: Vec<Row>,
    queries: Vec<Query>,
}
enum Store {
    Lance(LanceStore),
    Qdrant(Qdrant, String),
}
impl Store {
    async fn add(&self, rows: &[Row]) -> Result<()> {
        match self {
            Self::Lance(s) => {
                s.add(
                    rows.iter()
                        .map(|r| (r.id, r.source.clone(), r.vector.clone()))
                        .collect(),
                )
                .await?
            }
            Self::Qdrant(c, n) => {
                c.upsert_points(
                    UpsertPointsBuilder::new(
                        n,
                        rows.iter()
                            .map(|r| {
                                PointStruct::new(
                                    r.id as u64,
                                    r.vector.clone(),
                                    [("source", r.source.clone().into())],
                                )
                            })
                            .collect::<Vec<_>>(),
                    )
                    .wait(true),
                )
                .await?;
            }
        }
        Ok(())
    }
    async fn query(&self, q: &[f32], scope: &[String]) -> Result<Vec<i64>> {
        Ok(match self {
            Self::Lance(s) => s
                .search(q, scope, 5)
                .await?
                .into_iter()
                .map(|h| h.chunk_id)
                .collect(),
            Self::Qdrant(c, n) => {
                let mut req = QueryPointsBuilder::new(n).query(q.to_vec()).limit(5);
                if !scope.is_empty() {
                    req = req.filter(Filter::any(
                        scope
                            .iter()
                            .map(|s| Condition::matches("source", s.clone())),
                    ));
                }
                c.query(req)
                    .await?
                    .result
                    .into_iter()
                    .filter_map(|p| match p.id?.point_id_options? {
                        PointIdOptions::Num(x) => Some(x as i64),
                        _ => None,
                    })
                    .collect()
            }
        })
    }
    async fn delete_source(&self, source: &str) -> Result<()> {
        match self {
            Self::Lance(s) => s.replace_source(source, vec![]).await?,
            Self::Qdrant(c, n) => {
                c.delete_points(
                    DeletePointsBuilder::new(n)
                        .points(Filter::all([Condition::matches(
                            "source",
                            source.to_owned(),
                        )]))
                        .wait(true),
                )
                .await?;
            }
        }
        Ok(())
    }
}
fn pct(values: &[f64], p: f64) -> f64 {
    let mut a = values.to_vec();
    a.sort_by(f64::total_cmp);
    a[((a.len() - 1) as f64 * p).ceil() as usize]
}
fn rss() -> Option<String> {
    std::fs::read_to_string("/proc/self/status")
        .ok()?
        .lines()
        .find(|l| l.starts_with("VmHWM:"))
        .map(str::to_owned)
}
#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<_> = std::env::args().collect();
    ensure!(
        args.len() == 5,
        "usage: stores_bench lance|qdrant corpus.json index-dir|grpc-url output.json"
    );
    let corpus: Corpus = serde_json::from_slice(&std::fs::read(&args[2])?)?;
    ensure!(
        corpus.rows.len() >= 5 && !corpus.queries.is_empty(),
        "empty corpus"
    );
    let start = Instant::now();
    let store = if args[1] == "lance" {
        Store::Lance(LanceStore::open(&PathBuf::from(&args[3]), &corpus.model_fingerprint).await?)
    } else {
        let c = Qdrant::from_url(&args[3]).build()?;
        let n = format!("loklm_bench_{}", uuid::Uuid::new_v4().simple());
        c.create_collection(
            CreateCollectionBuilder::new(&n)
                .vectors_config(VectorParamsBuilder::new(1024, Distance::Cosine)),
        )
        .await?;
        Store::Qdrant(c, n)
    };
    let open_ms = start.elapsed().as_secs_f64() * 1000.;
    let start = Instant::now();
    store.add(&corpus.rows).await?;
    let ingest_ms = start.elapsed().as_secs_f64() * 1000.;
    let start = Instant::now();
    store.query(&corpus.queries[0].vector, &[]).await?;
    let first_query_ms = start.elapsed().as_secs_f64() * 1000.;
    let mut warm = vec![];
    let mut filtered = vec![];
    let mut recalls = vec![];
    let mut source_correct = 0;
    for _ in 0..10 {
        for q in &corpus.queries {
            let start = Instant::now();
            let result = store.query(&q.vector, &[]).await?;
            warm.push(start.elapsed().as_secs_f64() * 1000.);
            let mut oracle: Vec<_> = corpus
                .rows
                .iter()
                .map(|r| {
                    (
                        r.id,
                        r.vector
                            .iter()
                            .zip(&q.vector)
                            .map(|(a, b)| f64::from(*a) * f64::from(*b))
                            .sum::<f64>(),
                    )
                })
                .collect();
            oracle.sort_by(|a, b| b.1.total_cmp(&a.1));
            let expected: HashSet<_> = oracle.iter().take(5).map(|x| x.0).collect();
            recalls.push(result.iter().filter(|x| expected.contains(x)).count() as f64 / 5.);
            if result
                .first()
                .and_then(|id| corpus.rows.iter().find(|r| r.id == *id))
                .is_some_and(|r| r.source == q.expected_source)
            {
                source_correct += 1;
            }
            let start = Instant::now();
            let scoped = store.query(&q.vector, &[q.expected_source.clone()]).await?;
            filtered.push(start.elapsed().as_secs_f64() * 1000.);
            ensure!(
                scoped.iter().all(|id| corpus
                    .rows
                    .iter()
                    .any(|r| r.id == *id && r.source == q.expected_source)),
                "filter leaked a source"
            );
        }
    }
    let source = &corpus.rows[0].source;
    let group: Vec<_> = corpus
        .rows
        .iter()
        .filter(|r| &r.source == source)
        .cloned()
        .collect();
    let start = Instant::now();
    store.delete_source(source).await?;
    let delete_ms = start.elapsed().as_secs_f64() * 1000.;
    ensure!(
        store
            .query(&corpus.queries[0].vector, &[source.clone()])
            .await?
            .is_empty(),
        "deleted source remains searchable"
    );
    let start = Instant::now();
    store.add(&group).await?;
    let update_ms = start.elapsed().as_secs_f64() * 1000.;
    let reader = async {
        let mut times = vec![];
        for q in corpus.queries.iter().cycle().take(100) {
            let t = Instant::now();
            store.query(&q.vector, &[]).await?;
            times.push(t.elapsed().as_secs_f64() * 1000.);
        }
        Ok::<_, anyhow::Error>(times)
    };
    // Use unrelated synthetic write IDs so expected query rows remain intact.
    let writer = async {
        for i in 0..10 {
            let mut r = group.clone();
            for row in &mut r {
                row.id += 10000 + i * 100;
            }
            store.add(&r).await?;
        }
        Ok::<_, anyhow::Error>(())
    };
    let (concurrent, writes) = tokio::join!(reader, writer);
    writes?;
    let concurrent = concurrent?;
    let index_bytes = if args[1] == "lance" {
        Some(
            walkdir::WalkDir::new(&args[3])
                .into_iter()
                .filter_map(|e| e.ok())
                .filter(|e| e.file_type().is_file())
                .filter_map(|e| e.metadata().ok())
                .map(|m| m.len())
                .sum::<u64>(),
        )
    } else {
        None
    };
    let report = json!({"store":args[1],"sdk_version":if args[1]=="lance"{"0.41.0"}else{"1.20.0"},"rows":corpus.rows.len(),"dimension":1024,"fingerprint":corpus.model_fingerprint,"index_mode":"default exact search on small corpus; no ANN claim","open_ms":open_ms,"first_query_ms":first_query_ms,"cold_cache":"not measured; no global OS cache eviction on shared machine","warm_p50_ms":pct(&warm,0.5),"warm_p95_ms":pct(&warm,0.95),"filter_p50_ms":pct(&filtered,0.5),"filter_p95_ms":pct(&filtered,0.95),"recall_at_5":recalls.iter().sum::<f64>()/recalls.len()as f64,"source_accuracy_at_1":source_correct as f64/warm.len()as f64,"ingest_ms":ingest_ms,"ingest_rows_sec":corpus.rows.len()as f64/(ingest_ms/1000.),"delete_source_ms":delete_ms,"reinsert_source_ms":update_ms,"concurrent_write_search_p50_ms":pct(&concurrent,0.5),"concurrent_write_search_p95_ms":pct(&concurrent,0.95),"client_peak_rss":rss(),"local_index_bytes":index_bytes});
    let mut report = report;
    let t = Instant::now();
    match &store {
        Store::Lance(_) => {
            let reopened =
                LanceStore::open(&PathBuf::from(&args[3]), &corpus.model_fingerprint).await?;
            ensure!(
                !reopened
                    .search(&corpus.queries[0].vector, &[], 5)
                    .await?
                    .is_empty(),
                "reopen lost rows"
            );
        }
        Store::Qdrant(_, name) => {
            report["collection"] = json!(name);
            let reopened = Qdrant::from_url(&args[3]).build()?;
            ensure!(
                !Store::Qdrant(reopened, name.clone())
                    .query(&corpus.queries[0].vector, &[])
                    .await?
                    .is_empty(),
                "reconnect lost rows"
            );
        }
    }
    report["client_reopen_and_search_ms"] = json!(t.elapsed().as_secs_f64() * 1000.);
    report["recovery_scope"] =
        json!("new client handle, same process and warm OS cache; separate crash test required");
    report["build_profile"] = json!(if cfg!(debug_assertions) {
        "debug"
    } else {
        "release"
    });
    std::fs::write(&args[4], serde_json::to_vec_pretty(&report)?)?;
    println!("{}", serde_json::to_string(&report)?);
    if let Store::Qdrant(c, n) = store {
        if std::env::var_os("LOKLM_BENCH_KEEP_DISPOSABLE").is_none() {
            c.delete_collection(n).await?;
        }
    }
    Ok(())
}
