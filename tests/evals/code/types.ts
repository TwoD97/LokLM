// Shared types for the code-retrieval / noisy-query eval (tests/evals/code).
//
// Why a separate eval from tests/evals/run.ts: the existing harness measures a
// DENSE-ONLY pipeline (embed -> cosine -> topK -> rerank) on a prose Q&A corpus
// and never runs the production RetrievalService. The code-retrieval failure
// mode ("how does the auth class work" -> docs/noise instead of AuthService)
// lives in the hybrid pipeline + code-aware heuristics, so this eval composes
// the REAL pure cores (chunkCode, fuseRrf, heuristics.ts) + the model bridges
// and varies one ablation toggle per candidate fix. See ROADMAP / the diagnosis
// in memory (project_code_retrieval_nl_noise).

export type Track = 'code' | 'doc'

/** One corpus chunk. Mirrors the production Chunk shape closely enough that the
 *  pipeline can adapt it to a SearchHit for the real heuristics: `headingPath`
 *  is exactly what codeChunker emits ([relPath, symbol?]). */
export interface CodeChunk {
  /** stable id, `${file}#${ordinal}` */
  id: string
  /** repo-relative source path, forward-slashed */
  file: string
  track: Track
  ordinal: number
  text: string
  /** code: [relPath, symbol?] ; doc: [heading...] ; null when neither */
  headingPath: string[] | null
  /** convenience: last headingPath segment for code chunks, else null */
  symbol: string | null
  pageFrom: number | null
  pageTo: number | null
}

export interface CodeCorpus {
  generatedAt: string
  /** roots that were walked, repo-relative */
  roots: string[]
  fileCount: number
  chunkCount: number
  codeChunkCount: number
  docChunkCount: number
  chunks: CodeChunk[]
}

/** Noise gradient for a single information need. Every target file gets one
 *  variant of each type so the eval can measure recall PER phrasing and the
 *  "evenness gap" between the cleanest and the noisiest. */
export type QueryType =
  | 'exact-symbol' // "AuthService" — the perfect query today's evals use
  | 'nl-description' // "how does the auth class work"
  | 'paraphrase' // "where is login and password handling implemented"
  | 'vague' // "how do users sign in"
  | 'misspelled' // "how does the authsrvice work"

export const QUERY_TYPES: QueryType[] = [
  'exact-symbol',
  'nl-description',
  'paraphrase',
  'vague',
  'misspelled',
]

export interface CodeQueryVariant {
  type: QueryType
  text: string
}

export interface CodeQueryItem {
  id: string
  /** repo-relative file that genuinely answers the need; the eval's target. A
   *  hit is any chunk whose `file` equals this. */
  targetFile: string
  /** primary symbol the file is "about", for symbol-track scoring + provenance */
  targetSymbol: string | null
  /** one-line justification that targetFile answers the need (agent-verified) */
  rationale: string
  variants: CodeQueryVariant[]
}

export interface CodeQueryDataset {
  generatedAt: string
  /** corpus file name this was authored against (targets must exist in it) */
  corpus: string
  items: CodeQueryItem[]
}
