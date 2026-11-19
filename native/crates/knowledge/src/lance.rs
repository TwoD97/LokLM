//! Official embedded LanceDB SDK, version pinned by Cargo.lock.
use anyhow::{Result, ensure};
use arrow_array::{
    Array, FixedSizeListArray, Float32Array, Int64Array, RecordBatch, StringArray,
    types::Float32Type,
};
use arrow_schema::{DataType, Field, Schema};
use futures::TryStreamExt;
use lancedb::query::{ExecutableQuery, QueryBase};
use loklm_core::retrieval::RankedHit;
use std::{path::Path, sync::Arc};

pub struct LanceStore {
    table: lancedb::Table,
}
impl LanceStore {
    pub async fn open(path: &Path, fingerprint: &str) -> Result<Self> {
        let db = lancedb::connect(
            path.to_str()
                .ok_or_else(|| anyhow::anyhow!("UTF-8 index path required"))?,
        )
        .execute()
        .await?;
        let name = format!("vectors_{fingerprint}");
        let names = db.table_names().execute().await?;
        let table = if names.contains(&name) {
            db.open_table(name).execute().await?
        } else {
            db.create_empty_table(name, schema()).execute().await?
        };
        Ok(Self { table })
    }
    pub async fn replace_source(
        &self,
        source: &str,
        rows: Vec<(i64, String, Vec<f32>)>,
    ) -> Result<()> {
        uuid::Uuid::parse_str(source)?;
        self.table.delete(&format!("source = '{source}'")).await?;
        self.add(rows).await
    }
    pub async fn rebuild(&self, rows: Vec<(i64, String, Vec<f32>)>) -> Result<()> {
        self.table.delete("true").await?;
        self.add(rows).await
    }
    pub async fn add(&self, rows: Vec<(i64, String, Vec<f32>)>) -> Result<()> {
        for slice in rows.chunks(512) {
            ensure!(
                slice.iter().all(|(_, _, v)| v.len() == 1024),
                "invalid vector dimension"
            );
            let batch = RecordBatch::try_new(
                schema(),
                vec![
                    Arc::new(Int64Array::from_iter_values(slice.iter().map(|r| r.0))),
                    Arc::new(StringArray::from_iter_values(
                        slice.iter().map(|r| r.1.as_str()),
                    )),
                    Arc::new(
                        FixedSizeListArray::from_iter_primitive::<Float32Type, _, _>(
                            slice
                                .iter()
                                .map(|r| Some(r.2.iter().copied().map(Some).collect::<Vec<_>>())),
                            1024,
                        ),
                    ),
                ],
            )?;
            self.table.add(batch).execute().await?;
        }
        Ok(())
    }
    pub async fn search(
        &self,
        vector: &[f32],
        scope: &[String],
        limit: usize,
    ) -> Result<Vec<RankedHit>> {
        let mut query = self
            .table
            .vector_search(vector)?
            .distance_type(lancedb::DistanceType::Cosine)
            .limit(limit);
        if !scope.is_empty() {
            for id in scope {
                uuid::Uuid::parse_str(id)?;
            }
            query = query.only_if(format!(
                "source IN ({})",
                scope
                    .iter()
                    .map(|s| format!("'{s}'"))
                    .collect::<Vec<_>>()
                    .join(",")
            ));
        }
        let batches = query.execute().await?.try_collect::<Vec<_>>().await?;
        let mut hits = Vec::new();
        for batch in batches {
            let ids = batch
                .column_by_name("id")
                .and_then(|x| x.as_any().downcast_ref::<Int64Array>())
                .ok_or_else(|| anyhow::anyhow!("missing Lance ids"))?;
            let distances = batch
                .column_by_name("_distance")
                .and_then(|x| x.as_any().downcast_ref::<Float32Array>())
                .ok_or_else(|| anyhow::anyhow!("missing Lance distances"))?;
            for i in 0..ids.len() {
                hits.push(RankedHit {
                    chunk_id: ids.value(i),
                    score: 1.0 - f64::from(distances.value(i)),
                });
            }
        }
        Ok(hits)
    }
}
fn schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Int64, false),
        Field::new("source", DataType::Utf8, false),
        Field::new(
            "vector",
            DataType::FixedSizeList(Arc::new(Field::new("item", DataType::Float32, true)), 1024),
            true,
        ),
    ]))
}
