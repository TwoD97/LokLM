// Query routing — regex/heuristic-first, no LLM call on the hot path.
//
// Two layers, deliberately separate:
//   - QueryBreadth ('focused' | 'broad' | 'summary') answers "how much context
//     does chunk retrieval need" and maps to a topK. Lives here since the
//     route layer reuses its patterns; QAService re-exports for back-compat.
//   - QueryRoute answers "which handler answers this query at all":
//     doc_summary → SummarizationService (cached whole-doc summary as context),
//     retrieval   → the existing chunk pipeline (default; every miss lands here).
//
// Routing failures NEVER error and NEVER ask the LLM to guess (LlamaIndex's
// RouterQueryEngine raises ValueError on ambiguous selection — we invert that:
// below-margin resolution falls through to retrieval). Precedence follows the
// ADR: explicit doc pin > unambiguous title match > default retrieval.

import { nonStopwordTokens } from '../retrieval/heuristics'

export type QueryBreadth = 'focused' | 'broad' | 'summary'

// 3 wins on the eval sweep (tests/evals/report/runs/2026-05-20T19-46-39…):
// across Qwen3-8B, Granite-3.3-8B and Mistral-Nemo-12B, k=3 was best- or
// tied-best on Nemotron-judged answer quality (~0.92), and TTFT scales
// with prompt length so smaller k is also a latency win. Bigger k didn't
// improve quality on this corpus and just slowed prefill.
//
// The eval set is mostly focused factoid questions ("what is X?", "wie funktioniert Y?").
// For summary / comparison / list-style intents 3 chunks is too few — the
// model can't see enough of the document to answer. classifyQueryBreadth
// detects those and bumps topK; callers that pin opts.topK (evals, tests)
// bypass the heuristic entirely.
const FOCUSED_TOP_K = 3
const BROAD_TOP_K = 8
const SUMMARY_TOP_K = 12

// Patterns deliberately tight: false-positives only cost prefill latency
// (topK 3→8 or 3→12) , false-negatives leave the answer underspecified ,
// which is the worse failure. When in doubt , stay focused.
// Note on `\b` and German umlauts: JS regex `\b` is ASCII-only , so
// `\bübersicht\b` does NOT match "übersicht" at start of string (the position
// before 'ü' is not a word boundary because 'ü' isn't \w). Patterns containing
// non-ASCII letters at their edges drop the `\b` and rely on the stem itself
// being unique enough to avoid false positives.
const SUMMARY_PATTERNS: RegExp[] = [
  /\bsummari[sz]e\b/i,
  /\bsummary\b/i,
  /\btl;?dr\b/i,
  /\boverview\b/i,
  /\brecap\b/i,
  /\bin (a |one )?(few|short) (words|sentences)\b/i,
  /zusammenfass/i,
  /kurzfassung/i,
  /überblick/i,
  /übersicht/i,
  // "fasse … zusammen" / "fass das mal zusammen" — split verb , window-limited
  /\bfass(e|t|en)?\b[^.?!\n]{0,40}\bzusammen\b/i,
]

const BROAD_PATTERNS: RegExp[] = [
  /\blist (all|every|each|the)\b/i,
  /\benumerate\b/i,
  /\bwhat are (all|the)\b/i,
  /\bwhich (ones|of|are)\b/i,
  /\bevery\b/i,
  /\beach of\b/i,
  /\bcompare\b/i,
  /\bcontrast\b/i,
  /\bdifferences? between\b/i,
  /\bsimilarit(y|ies)\b/i,
  /\b(versus|vs\.?)\b/i,
  /\balle\b/i,
  /sämtliche/i,
  /\bjede[rs]?\b/i,
  /\bwelche\b/i,
  /\bnenne\b/i,
  /\bzähl(e|en)?\b[^.?!\n]{0,40}\bauf\b/i,
  /\bvergleich/i,
  /\bunterschied/i,
  /gegenüber/i,
]

/**
 * Classify a query by how much of the document(s) it needs to see.
 * Summary > broad > focused. Pure , regex-only , no LLM call — runs on the
 * hot path before retrieval. Bilingual (DE/EN) to match the rest of the
 * pipeline.
 */
export function classifyQueryBreadth(query: string): QueryBreadth {
  if (SUMMARY_PATTERNS.some((p) => p.test(query))) return 'summary'
  if (BROAD_PATTERNS.some((p) => p.test(query))) return 'broad'
  return 'focused'
}

/** Maps classified breadth to a topK. Exported for tests and for callers
 *  that want the heuristic without going through QAService.answer. */
export function adaptiveTopK(query: string): number {
  switch (classifyQueryBreadth(query)) {
    case 'summary':
      return SUMMARY_TOP_K
    case 'broad':
      return BROAD_TOP_K
    case 'focused':
      return FOCUSED_TOP_K
  }
}

// ---------------------------------------------------------------------------
// Route layer
// ---------------------------------------------------------------------------

export interface RouteDocument {
  id: number
  title: string
}

export type QueryRoute = { kind: 'doc_summary'; documentId: number } | { kind: 'retrieval' }

export interface RouteContext {
  /** NotebookLM-style source pin from the conversation. Exactly one pinned
   *  doc resolves the summary target without any title matching; several
   *  pinned docs restrict the title-match candidate set instead. */
  activeDocumentIds: number[] | null
  /** Lazy on purpose: the documents-table fetch (id + title) only happens
   *  when a route pattern actually fired , so the common focused-query path
   *  stays pure-regex with zero DB round-trips. */
  getDocuments: () => Promise<RouteDocument[]>
}

// Title-match acceptance gates for resolveTargetDocument. No upstream project
// ships a numeric margin default (LlamaIndex resolves embedding-only at
// top_k=1 , RAGFlow refuses query-text resolution entirely) , so these are
// ours to tune — queryRoute.test.ts pins the intended behaviour and the
// route eval measures the effect on real titles.
//   - coverage: matched fraction of the TITLE's non-stopword tokens. 0.5 means
//     "half the title appears in the query" — enough for filename-ish titles
//     ("TudosaDenys_Wochenbuch") without letting a single generic token
//     ("notes") claim an unrelated doc whose title is 4 tokens long.
//   - margin: best must be ≥ 2× the runner-up , otherwise the match is
//     ambiguous and we fall back to retrieval (false-negative is the cheaper
//     failure , same philosophy as the breadth patterns above).
export const TITLE_MATCH_MIN_COVERAGE = 0.5
export const TITLE_MATCH_MARGIN_RATIO = 2

export type TargetResolution =
  | { kind: 'resolved'; documentId: number }
  | { kind: 'ambiguous'; candidateIds: number[] }
  | { kind: 'none' }

// Titles are filenames for most import paths ("TudosaDenys_Wochenbuch.pdf").
// The extension would count as a title token and deflate coverage — a 2-token
// name becomes 3 and a full match of the meaningful part drops to 0.67, under
// the 0.5 gate once an author prefix joins in. Letters-only tail rather than
// an enumerated list so .rst and the importer's whole code-extension family
// (.py, .ts, .yaml, …) behave like .pdf — routing must not depend on source
// file type. Digit-bearing tails ("report.2024") are deliberately NOT
// stripped: more likely a meaningful suffix than an extension we import.
const TITLE_EXTENSION = /\.[a-z]{1,8}$/i

function titleTokens(title: string): Set<string> {
  return new Set(nonStopwordTokens(title.replace(TITLE_EXTENSION, '')))
}

// Summary-intent vocabulary stripped from QUERY tokens before title scoring.
// Every routed query necessarily contains one of these (they fired the route) ,
// so a title that itself contains the trigger word ("Zusammenfassung_Statistik
// .pdf" , "Project Overview.docx" — common names in a study-notes corpus)
// would get a free matched token and capture queries about OTHER topics:
// "gib mir eine zusammenfassung der prüfungsthemen" must not resolve to
// Zusammenfassung_Statistik.pdf. Title-side tokens stay untouched — the
// intent word keeps inflating the denominator , which only makes the gate
// stricter. Single-token entries cover what the multi-word patterns above
// can't match against an isolated token (tl;dr splits to tl/dr , the split
// verb "fasse … zusammen" splits to fasse/zusammen).
const SUMMARY_INTENT_TOKENS = new Set([
  'summarize',
  'summarise',
  'summary',
  'overview',
  'recap',
  'tldr',
  'tl',
  'dr',
  'zusammenfassung',
  'zusammenfassungen',
  'zusammenfassen',
  'kurzfassung',
  'überblick',
  'übersicht',
  'fasse',
  'fass',
  'fasst',
  'fassen',
  'zusammen',
])

/**
 * Resolve which document a query talks about by matching the query's
 * non-stopword tokens against document titles (same tokenizer as
 * applyTitleBoost). Pure — no I/O, no LLM.
 */
export function resolveTargetDocument(
  query: string,
  docs: ReadonlyArray<RouteDocument>,
): TargetResolution {
  const qTokens = new Set(nonStopwordTokens(query).filter((t) => !SUMMARY_INTENT_TOKENS.has(t)))
  if (qTokens.size === 0) return { kind: 'none' }

  const scored: Array<{ id: number; coverage: number }> = []
  for (const d of docs) {
    const tTokens = titleTokens(d.title)
    if (tTokens.size === 0) continue
    let overlap = 0
    for (const t of tTokens) {
      if (qTokens.has(t)) overlap++
    }
    if (overlap === 0) continue
    scored.push({ id: d.id, coverage: overlap / tTokens.size })
  }
  if (scored.length === 0) return { kind: 'none' }

  scored.sort((a, b) => b.coverage - a.coverage)
  const best = scored[0]!
  const second = scored[1]
  if (best.coverage < TITLE_MATCH_MIN_COVERAGE) return { kind: 'none' }
  if (second && best.coverage < second.coverage * TITLE_MATCH_MARGIN_RATIO) {
    // Everything within the margin band of the winner is a plausible target —
    // surface them so a future disambiguation UI (or the caller's logging)
    // can show what tied. Today's caller just falls back to retrieval.
    const cutoff = best.coverage / TITLE_MATCH_MARGIN_RATIO
    return {
      kind: 'ambiguous',
      candidateIds: scored.filter((s) => s.coverage >= cutoff).map((s) => s.id),
    }
  }
  return { kind: 'resolved', documentId: best.id }
}

/**
 * Decide the route for a query. Async only for the lazy documents fetch —
 * queries without route intent return synchronously-fast without touching
 * the DB. Never throws on resolution failure; every miss is `retrieval`.
 */
export async function resolveRoute(query: string, ctx: RouteContext): Promise<QueryRoute> {
  if (classifyQueryBreadth(query) !== 'summary') return { kind: 'retrieval' }

  const active = ctx.activeDocumentIds
  if (active && active.length === 1) {
    return { kind: 'doc_summary', documentId: active[0]! }
  }

  let docs: RouteDocument[]
  try {
    docs = await ctx.getDocuments()
  } catch {
    // DB hiccup must not kill the answer pipeline — retrieval still works.
    return { kind: 'retrieval' }
  }
  // A multi-doc pin restricts the candidate set: "summarize the lab report"
  // with three pinned docs should only consider those three.
  const candidates = active && active.length > 0 ? docs.filter((d) => active.includes(d.id)) : docs

  const res = resolveTargetDocument(query, candidates)
  if (res.kind === 'resolved') return { kind: 'doc_summary', documentId: res.documentId }
  return { kind: 'retrieval' }
}
