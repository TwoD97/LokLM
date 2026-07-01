// The ablation matrix. Each config isolates or stacks one candidate fix from
// the diagnosis (memory project_code_retrieval_nl_noise) so the report shows
// which lever moves noisy-query recall and which combination "works evenly".
//
// `base` mirrors production MINUS the cross-encoder so the recall mechanics are
// isolated cleanly and the fix variants stay fast; `prod` and `all_fixes_rr`
// add the reranker back for a faithful reference.

import type { Ablation } from './pipeline'

const base: Omit<Ablation, 'name'> = {
  queryInstruction: false,
  symbolFts: false,
  codeSymbolBoost: true, // prod default on
  codeFilenameBoost: 'exact', // prod default
  codeShare: 'intent', // prod default (fires only on literal identifiers)
  dynamicK: false,
  rerank: false,
  roleBoost: false,
  docPenalty: false,
  bm25Expand: false,
  laySymbolBoost: false,
}

const allFixes: Omit<Ablation, 'name'> = {
  ...base,
  queryInstruction: true,
  symbolFts: true,
  codeShare: 'always',
  codeFilenameBoost: 'substring',
  dynamicK: true,
  roleBoost: true,
  docPenalty: true,
}

// R3/R4 (0.6.5): the German-query fixes shipped in RetrievalService/heuristics —
// BM25 query expansion (bridge + identifier subtokens) and the lay-term symbol
// boost. `code_rag_v2` is the full shipped configuration: all_fixes + both.
const codeRagV2: Omit<Ablation, 'name'> = {
  ...allFixes,
  bm25Expand: true,
  laySymbolBoost: true,
}

export const ABLATIONS: Ablation[] = [
  { ...base, name: 'prod', rerank: true }, // faithful current production
  { ...base, name: 'base_norr' }, // production minus reranker (isolates recall)
  { ...base, name: 'f1_qinstr', queryInstruction: true }, // fix #1
  { ...base, name: 'f4_symfts', symbolFts: true }, // fix #4
  { ...base, name: 'f2_shareAll', codeShare: 'always' }, // fix #2 recall
  { ...base, name: 'f2_fnSubstr', codeFilenameBoost: 'substring' }, // fix #2 precision
  { ...base, name: 'f3_dynK', dynamicK: true }, // fix #3
  { ...base, name: 'f5_role', roleBoost: true }, // fix #5: prefer source over tests/evals
  { ...base, name: 'f6_docpref', docPenalty: true }, // fix #6: prefer code over docs (code-intent)
  { ...base, name: 'recall_combo', queryInstruction: true, symbolFts: true }, // #1 + #4
  { ...base, name: 'f7_bm25de', bm25Expand: true }, // R3: DE→EN bridge + subtokens in BM25
  { ...base, name: 'f8_laysym', laySymbolBoost: true }, // R4: lay-term symbol substring boost
  { ...allFixes, name: 'all_fixes' },
  { ...allFixes, name: 'all_fixes_rr', rerank: true },
  { ...codeRagV2, name: 'code_rag_v2' }, // all_fixes + R3 + R4 (upper bound incl. symbolFts)
  // EXACTLY what ships in 0.6.5 for a codebase workspace (no rerank): the ADR-0006
  // defaults + R3/R4 — but WITHOUT symbolFts (context_prefix in FTS is not built
  // yet) and without dynamicK (opt-in, default off). The honest production number.
  {
    ...base,
    name: 'prod_v2',
    queryInstruction: true,
    codeFilenameBoost: 'substring',
    codeShare: 'always',
    roleBoost: true,
    docPenalty: true,
    bm25Expand: true,
    laySymbolBoost: true,
  },
]
