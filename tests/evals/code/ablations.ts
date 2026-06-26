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
  { ...allFixes, name: 'all_fixes' },
  { ...allFixes, name: 'all_fixes_rr', rerank: true },
]
