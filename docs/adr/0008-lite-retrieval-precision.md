# ADR-0008: Lite retrieval precision — reranker, full-text scoring, relevance floor

Status: Accepted
Date: 2026-06-28
Supersedes (in part): ADR-0007 (the "reranker off on lite" + "CPU leading-slice rerank" levers)
Builds on: ADR-0007 (lite preset), ADR-0006 (rerank / score-gap dynamic-K), ADR-0003 (RAG pipeline)

## Context

ADR-0007 turned the reranker **off** on the `lite` tier to spare low-RAM /
iGPU machines its cost, leaning on BM25 + dense + RRF fusion alone. Field
testing on a real lite install (German technical study-sheet corpus) showed
that fusion-only retrieval feeds the small model **noise**, and the model then
confabulates a confident wrong answer. Traced from the live app with per-stage
score logging on the query „Was ist ein Interpreter?":

- **Dense cosine collapses on short keyword queries.** bge-m3 scored every
  candidate ~0.45–0.55 — it could not separate the interpreter chunk (0.49)
  from a `team_roles` chunk (0.489). Topically-adjacent noise (the LokLM
  project handbook's own docs) outranked on-topic chunks purely because they
  are "about software".
- **RRF scores are not thresholdable.** Fusion overwrites the BM25/cosine score
  with `1/(k+rank)` (~0.03 at best), so a relevance floor on the fused score is
  meaningless and there is no quality gate at all.
- **No cross-encoder to clean the pool.** With rerank off, the only stages left
  rank by lexical/semantic _recall_, not _relevance_. A fixed `topK` then pads
  the fed set to a count, dragging the bottom of the pool (pure noise) into the
  prompt.
- **Coarse chunks compound it.** A multi-Q&A study sheet packs several topics
  per chunk. The golden chunk for "interpreter" _began_ with unrelated backup
  text; its definition sat past the first ~1000 chars. ADR-0007's CPU
  leading-slice rerank scored only that intro, judged it irrelevant, and
  dropped the single best chunk to ~0.

Net effect: the model was fed 2 relevant chunks buried in 5 noise ones (or, with
leading-slice, missed the golden chunk entirely) and answered "interpreter" with
the _Just-In-Time-Compiler_ section from the adjacent chunk fragment.

## Decision

Make retrieval **precision** the default on lite, not a standard/pro luxury. Six
coordinated levers:

| Lever                       | Decision                                                                                                                                                                                                                                                                                                                                                        | Where                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Reranker on lite            | **On** (default-on all tiers). Bundle `bge-reranker-v2-m3` in the **lite installer** (it was standard/pro-only), warm it, and show its row/dot in the UI (`WarmingView`, `TitleBar`). A one-time startup normalization flips the persisted `enabled:false` that old lite installs baked in (the toggle was UI-hidden, so that `false` was never a user choice). | `index.ts`, `installer-wizard/model-manifest.json`, `WarmingView`, `TitleBar` |
| Full-text rerank            | Score the **whole passage**, never a leading slice. The slice assumed relevance sits up front — false for coarse multi-topic chunks.                                                                                                                                                                                                                            | `RetrievalService.maybeRerank`                                                |
| Relevance floor             | Drop reranked chunks below **0.2** _before_ diversification, so a fixed `topK` can't pad with noise and round-robin doc-variety can't pull a 0.08 chunk in ahead of a 0.70 one. Only when rerank actually ran (real scores); the top hit is always kept.                                                                                                        | `RetrievalService`, `CHAT_RELEVANCE_FLOOR`                                    |
| BM25-lean fusion            | When **no** reranker runs (RRF fallback), weight the lexical list ×2 so a strong literal-term hit isn't outvoted by collapsed cosine ranks.                                                                                                                                                                                                                     | `rrf.ts`, `RetrievalService`                                                  |
| Lean candidate pool on lite | Force `cpuOptimized` so the iGPU (which mislabels as a fast GPU) reranks ~20 candidates, not ~40.                                                                                                                                                                                                                                                               | `index.ts` lite preset                                                        |
| Answer depth on lite        | `concise` → **`standard`**. Once retrieval feeds the right chunk, a terse answer reads as under-developed.                                                                                                                                                                                                                                                      | `LlamaService.PROFILE_TO_DEPTH`                                               |

The relevance floor and BM25 lean are **gated complements**: with rerank on, the
floor does the trimming and the BM25 lean is neutral; with rerank off, the lean
carries precision and the floor is skipped (RRF scores aren't comparable to it).

### Measured effect (reference machine, „Was ist ein Interpreter?")

|                    | ADR-0007 (rerank off)                   | This ADR                                   |
| ------------------ | --------------------------------------- | ------------------------------------------ |
| Fed chunks         | 7 (2 relevant + 5 noise)                | 4, all relevant (golden chunks 219+220)    |
| Top signal         | RRF 0.035 (noise-indistinguishable)     | rerank 0.95 vs noise ≤0.13                 |
| Answer             | confabulated (JIT section, "Java/.NET") | the source's actual interpreter definition |
| Citations          | 1 (a noise chunk)                       | grounded on the definition chunks          |
| Rerank time (iGPU) | n/a                                     | ~19 s leading-slice → ~35 s full-text      |

## Trial and error — what we tried and REJECTED

1. **Prompt-only fixes first.** Strengthened the grounding rule ("don't complete
   a mentioned-but-undefined term from general knowledge") and added a
   "use the whole context, don't cherry-pick" directive. Necessary but **not
   sufficient** — a 4B model still confabulated because the _right chunk wasn't
   being fed_. Prompt changes can't fix a retrieval-quality problem.
2. **Reusing the existing `dynamicScoreCutCount` (ADR-0006) for the floor.
   REJECTED.** It sigmoid-normalizes assuming cross-encoder _logits_; this
   reranker emits 0–1 probabilities, so the sigmoid flattened the 0.53→0.12
   cliff to 0.63→0.53 (16 %, below its 40 % trigger) and it never cut. A flat
   floor on the raw score is the right tool for this score scale.
3. **Thresholding the RRF/fused score. REJECTED** — it is `1/(k+rank)` by
   construction (~0.03), carries no relevance meaning, and a floor on it wipes
   the slate. The floor must key on reranker scores only.
4. **Shrinking the rerank _candidate pool_ to "feed fewer". MISCONCEPTION.** The
   pool is the reranker's _input_ — it must be scored to find relevance, so it
   can't be sized by relevance. The dynamic part is the _output_ (the floor).

## Consequences

- **Lite bundle grows ~0.4 GB** (1.72 → 2.16 GB) and the reranker uses RAM on
  the 8 GB machines ADR-0007 was protecting. Accepted: correctness was the whole
  point of the tier being usable. Still a user-toggleable setting — default-on,
  not forced-on.
- **Rerank adds TTFT** (~19–35 s on the iGPU; full-text > leading-slice). Within
  the tier's already-minute-scale prefill budget; the lever if it hurts is a
  smaller candidate pool, **not** re-truncating passages.
- **The deeper cause remains: coarse chunking.** Full-text rerank + the floor
  _work around_ multi-topic chunks; they don't fix them. The permanent fix is
  structure-aware chunking (one chunk per „Frage/Antwort" unit), which needs a
  re-embed and is deferred. Until then, a definition split across a chunk
  boundary is healed only because _both_ halves now clear the floor and get fed.
- ADR-0007's lite preset otherwise stands (8 K context, multiQuery/wholeDoc off,
  heuristic contextualize, embedder-first warming). Only its **reranker-off** and
  **leading-slice rerank** decisions are reversed here.
