// By-query-type metrics for the code-retrieval eval. The whole point is to read
// recall PER phrasing (exact-symbol vs the noisy types) and the EVENNESS gap
// between the cleanest and the noisiest — "make it work evenly" means closing
// that gap without dropping exact-query recall.

import type { QueryType } from './types'
import { QUERY_TYPES } from './types'

/** One graded query: the 1-based rank of the FIRST retrieved chunk whose file
 *  is the target, or null when the target never appears in the returned list. */
export interface QueryResult {
  type: QueryType
  rank: number | null
}

export interface TypeMetrics {
  group: QueryType | 'all'
  n: number
  recallAt1: number
  recallAt5: number
  recallAt10: number
  mrr: number
}

function recallAt(results: QueryResult[], k: number): number {
  if (results.length === 0) return 0
  let hit = 0
  for (const r of results) if (r.rank !== null && r.rank <= k) hit++
  return hit / results.length
}

function mrr(results: QueryResult[]): number {
  if (results.length === 0) return 0
  let total = 0
  for (const r of results) if (r.rank !== null) total += 1 / r.rank
  return total / results.length
}

export function aggregate(results: QueryResult[], group: QueryType | 'all'): TypeMetrics {
  return {
    group,
    n: results.length,
    recallAt1: recallAt(results, 1),
    recallAt5: recallAt(results, 5),
    recallAt10: recallAt(results, 10),
    mrr: mrr(results),
  }
}

export interface ConfigMetrics {
  config: string
  overall: TypeMetrics
  byType: TypeMetrics[]
  /** recall@5 of the noisiest-scoring query type — the floor the config must lift */
  worstNoisyRecallAt5: number
  /** recall@5(exact-symbol) − worstNoisyRecallAt5; 0 == perfectly even */
  evennessGap: number
}

export function summarizeConfig(
  config: string,
  byType: Map<QueryType, QueryResult[]>,
): ConfigMetrics {
  const all: QueryResult[] = []
  const perType: TypeMetrics[] = []
  for (const t of QUERY_TYPES) {
    const rs = byType.get(t) ?? []
    all.push(...rs)
    perType.push(aggregate(rs, t))
  }
  const exact = perType.find((m) => m.group === 'exact-symbol')?.recallAt5 ?? 0
  const noisy = perType.filter((m) => m.group !== 'exact-symbol')
  const worstNoisy = noisy.length > 0 ? Math.min(...noisy.map((m) => m.recallAt5)) : 0
  return {
    config,
    overall: aggregate(all, 'all'),
    byType: perType,
    worstNoisyRecallAt5: worstNoisy,
    evennessGap: exact - worstNoisy,
  }
}
