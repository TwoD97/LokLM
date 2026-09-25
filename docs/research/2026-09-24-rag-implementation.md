# RAG implementation and validation — 24 September 2026

Implemented the first correctness batch from the [research roadmap](2026-09-24-rag-roadmap.md), plus bounded document-structure and cancellation improvements. The 4 GB GPU policy remains in place: no default reranker, no additional model, and no new sidecar.

## What changed

- **One context allocation:** QA now budgets the full rendered prompt, recent history, pinned sources, retrieved passages, optional overview, output, and framing together. Output reserves scale with the resolved window: 1,024 tokens at 4K and 2,048 at 8K. The same limit reaches inference. Estimates use the longest supported system prompt and include source headers; they remain character-based estimates, not tokenizer guarantees.
- **Evidence selection:** primary passages are considered before neighbors, oversized passages are skipped without stopping selection, and duplicate pin/RAG passages are supplied only once. Original citable text is never silently shortened. Pinned documents share an aggregate allowance in document rounds, avoiding the case where four individually oversized fair shares rejected every passage. Unused pinned capacity returns to retrieved evidence.
- **Clear context-limit behavior:** if sources exist but none fit, the app explains the context limit and suggests a larger context or smaller indexed sections. It no longer incorrectly says the information does not exist. An oversized question receives a separate actionable error.
- **Balanced hybrid retrieval:** lexical and dense lists use equal weights. All bounded query-arm contributions accumulate before the final cap, with deterministic ties and per-list duplicate protection. The no-reranker path applies existing native-score eligibility before capping, preserving valid lexical evidence behind repeated weak semantic matches. Successful reranking remains bounded; unavailable/failed/invalid reranking uses the same fallback.
- **Failure and cancellation handling:** asynchronous vector-search failure now reaches its intended BM25 fallback. Cancellation reaches query expansion and translation and is checked between retrieval stages. Native embedding/reranking can finish its current operation, but cancelled results cannot launch later stages or become a fallback answer.
- **Provider consistency:** external providers are classified through their inference capability, rather than a missing local GPU label. Ollama chat and raw generation explicitly request the context used for budgeting; chat receives the reserved output limit. User cancellation stays connected through streamed body consumption, including a stalled read, and stream cleanup cancels/releases the response body. Ollama documents the per-request context option in its [official FAQ](https://github.com/ollama/ollama/blob/main/docs/faq.mdx#how-can-i-specify-the-context-window-size).
- **Markdown tables:** oversized tables split between complete rows and repeat their original headers where a complete row/header fits. Units, years, section metadata, and escaped pipes are covered by fixtures. Heading and overlap size overruns are corrected. Pathologically wide rows fall back to bounded plain text; this is not a new PDF table extractor.
- **Index input consistency:** fresh ingestion and deferred embedding backfill share the same input construction, with byte-for-byte existing semantics and an import-failure/backfill parity regression. No contextual prefixes were activated and no automatic reindex occurred.

## Validation completed

- **404 tests across 26 relevant suites passed** in the final combined run: prompt packing, summary/inventory routing, follow-up context, retrieval/fusion/fallback, cancellation, provider limits/streams, chunking, ingestion/backfill, and the production-path mechanics matrix.
- **One real SQLite retrieval integration test passed** under Electron-as-Node. The installed SQLite module has Electron ABI 146, so plain Node ABI 137 could not load it. No native dependency rebuild was needed.
- Full `pnpm.cmd typecheck` passed.
- `pnpm.cmd build` passed for main, preload, and renderer.
- Targeted lint passed without errors; existing unused suppression comments produce warnings in the Llama/QA services.
- `pnpm.cmd evals:production --out tests/evals/production/reports/final-2026-09-24.json` passed its mechanical gates. The [final report](../../tests/evals/production/reports/final-2026-09-24.json) records 22 passing cases, two explicit known limitations, and zero unexpected failures, including source/fixture hashes. The command uses deterministic inference and index fixtures around the real production services.

Synthetic regressions demonstrate that semantic-only candidates survive a full lexical pool, consensus ranking survives query-order changes, valid lexical candidates survive repeated weak dense consensus, and required evidence/citations survive 4K/8K packing. These are correctness checks, not measured improvements in model recall, answer quality, or latency.

The earlier initial capture was taken after some edits had already landed; it is labelled as an intermediate capture, not a before-change benchmark. No historical end-to-end baseline has been manufactured.

## Deliberate limits and remaining work

The current weak-match fallback can still ask the model to answer from insufficient evidence. Two cases record this failure explicitly rather than counting it as a quality pass. Calibrated answerability and claim-level citation support still require a representative, manually checked corpus and real generation.

No GPU inference benchmark ran during this batch. The existing LokLM session was running and the 4 GB GPU had approximately 1.8 GB in use. Its process, vault, and GPU allocations were left alone. Native latency, token-estimation error, and answer-quality comparisons remain unmeasured for these changes; the [harness README](../../tests/evals/production/README.md) describes the isolated native run.

After the user closed that session, a separate [native GPU calibration](2026-09-24-native-calibration.md) measured the installed models in isolated temporary vaults. That report supersedes the measurement status above and records accepted resource changes, rejected experiments, and answer-quality limitations.

Markdown chunking changes apply to new imports and explicit reindexing. Existing indexes are preserved. Activating new document-title/section prefixes needs versioned embedding-input metadata and a safe reindex rollout; see [source-structure rollout](2026-09-24-source-structure-rollout.md). PDF layout/table extraction, mixed-image OCR coverage warnings, late chunking, and GraphRAG remain separate experiments.

The development evaluation command is now `pnpm.cmd evals:production`. The two legacy scale commands also point to their actual script locations, with corrected dataset/library/report paths; the expensive scale/model evaluations were not run.

Restart the development app to load the updated backend. Retrieval and context fixes apply to existing indexed sources immediately; only the new chunk boundaries require reindexing affected documents.
