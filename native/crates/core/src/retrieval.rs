use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct RankedHit {
    pub chunk_id: i64,
    pub score: f64,
}
/// Port of fuseRrfLists: one vote per list, sum sorted contributions before cap,
/// deterministic ID ties, never cap the intermediate accumulator.
pub fn fuse_rrf(lists: &[(Vec<RankedHit>, f64)], cap: usize) -> Vec<RankedHit> {
    let mut scores: BTreeMap<i64, Vec<f64>> = BTreeMap::new();
    for (list, weight) in lists {
        if !weight.is_finite() || *weight < 0.0 {
            continue;
        }
        let mut seen = BTreeSet::new();
        for (i, hit) in list.iter().enumerate() {
            if seen.insert(hit.chunk_id) {
                scores
                    .entry(hit.chunk_id)
                    .or_default()
                    .push(weight / (60.0 + i as f64 + 1.0));
            }
        }
    }
    let mut out = scores
        .into_iter()
        .map(|(chunk_id, mut s)| {
            s.sort_by(f64::total_cmp);
            RankedHit {
                chunk_id,
                score: s.iter().sum(),
            }
        })
        .collect::<Vec<_>>();
    out.sort_by(|a, b| {
        b.score
            .total_cmp(&a.score)
            .then(a.chunk_id.cmp(&b.chunk_id))
    });
    out.truncate(cap);
    out
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fusion_is_stable_and_deduplicates() {
        let h = |id| RankedHit {
            chunk_id: id,
            score: 0.0,
        };
        let a = (vec![h(1), h(1), h(2)], 1.0);
        let b = (vec![h(2), h(1)], 2.0);
        assert_eq!(fuse_rrf(&[a.clone(), b.clone()], 10), fuse_rrf(&[b, a], 10));
        assert_eq!(
            fuse_rrf(&[(vec![h(1), h(1)], 1.0)], 10)[0].score,
            1.0 / 61.0
        );
    }
}
