# Production-path mechanics regression

This small deterministic suite runs the real `RetrievalService.search` and `QAService.answer`, including fusion, neighbor expansion, context packing, refusal, streaming, and citation emission. An in-memory adapter supplies fixed lexical/dense index results for an artificial corpus. Embedding and generation are fixtures; no model, GPU, vault, external service, or downloads are used.

**It is not a model-quality, parser, tokenizer-accuracy, or performance benchmark.** Cross-language cases verify that provided dense evidence reaches the answer; they do not measure whether an actual embedder can find or translate it. The table case checks preservation of row text, not PDF table extraction or arithmetic reasoning. The fake answer deliberately says `SYNTHETIC INFERENCE` rather than pretending to answer the question.

## Run

From the repository root:

```powershell
pnpm.cmd exec vitest run --project unit tests/unit/production-rag-path.test.ts
pnpm.cmd evals:production
pnpm.cmd exec tsx tests/evals/production/run.ts --check --out tests/evals/production/reports/my-run.json
```

The CLI refuses to overwrite an existing report. Without `--out`, it prints JSON after production diagnostics. `--check` exits nonzero for unexpected mechanical failures. Known limitations remain explicitly failed rows and are counted separately.

Each case runs at 4,096 and 8,192 context tokens, with reranker, multi-query generation, contextualization and special routing disabled. Fixed title, recency and language weights avoid clock-dependent or incidental score effects. The neighbor case enables the production neighbor-expansion option through a recording subclass; no retrieval implementation is replaced.

Reports include source-content hashes, git commit/dirty state, fixture hash, retrieved IDs/origins, actual evidence passed to inference, emitted citations, required evidence text coverage, refusal/generation counts, original-text preservation, and final prompt plus generation budget estimates. The total includes the longest supported system prompt, fully rendered user prompt/history, actual requested output cap, and production framing margin. No latency number from this fixture is meaningful. The prompt estimate uses the production estimator, not actual model tokenization.

## Cases and gates

- German date/price and English table evidence.
- German question/English evidence and the reverse, with dense-only retrieval.
- Two required documents, including an oversized adjacent chunk between their primary hits.
- Long conversation history while current two-document evidence remains available, with and without multiple pins (including a pin/retrieval duplicate).
- Single oversized passage: an explicit context-limit message rather than an overflowing prompt, modified source excerpt, or a claim that no source exists.
- Empty evidence: localized refusal and no generation in both languages.
- Weak-only dense evidence: **known unresolved failure**. Current retrieval retains top-ranked weak evidence, so generation is invoked for an unanswerable question. This is recorded as a failed answerability expectation, excluded only from this batch's mechanical release gate. It must not be counted as a quality pass.

Hard gates require intact required evidence, source text unchanged, emitted citations exactly equal the fed evidence, estimated prompt plus actual requested generation budget within the configured context, and no generation on gated no-evidence cases. They do not assess the fake answer's correctness.

## Capture provenance

`reports/initial-capture-2026-09-24.json` was captured after the new skip-oversize/context-priority packer had already landed, before subsequent QA budget work. It contains the initial ten-case matrix and exact source/fixture hashes. It is **not a before-change benchmark**. Later reports use the expanded history fixture; compare rows by case ID, context and fixture definition, not aggregate counts alone.

## Bounded native check plan — not executed by this suite

Use the existing isolated Electron helpers (`tests/e2e/helpers/launch.ts`, `seed.ts`) and `chat-gpu-handoff.spec.ts`/`indexing-native.spec.ts`. Schedule GPU work serially; close competing inference sessions. Build once, pin Standard model files already installed, and record their hashes. Keep the user's vault out of the run.

1. Set `LOKLM_LLM_CONTEXT_SIZE=4096`, reranker policy Off, and `LOKLM_RETRIEVAL_TRACE=1`; record the **resolved** context/GPU-layer plan. Repeat at 8192 if allocation succeeds. A smaller resolved window is a distinct configuration, not a successful 8K measurement.
2. Import one German PDF, one English Markdown document, and a small code fixture through `api.documents.import`; await ready and vector counts. Use the existing PDF indexing regression for import/progress/cancellation.
3. Submit six manually checked questions through `api.chat.stream`: date/price, table cell, DE→EN source, multi-source, code identifier, and absent fact. Capture stream errors, final answer, citations, actual stage events and elapsed click-to-first-token/final time.
4. Check citations against source text and the actual packed evidence. Separate retrieval miss, packing loss, unsupported answer and false refusal; a correct-looking answer without supplied support is not a success.
5. One fresh-process query records cold loading; three repeats record warm timings separately. After one indexing job, repeat a QA question to check recovery to chat and include swap delay. Do not average cold/swap/warm timings together.
6. Stop on a hang, allocation failure or worker crash. No parallel model matrix and no large local judge. Human review of this small sample is the quality check.

Existing smoke commands (these invoke real GPU work and are intentionally not run by the deterministic suite):

```powershell
pnpm.cmd build
$env:LOKLM_NATIVE_CHAT='1'
$env:LOKLM_LLM_CONTEXT_SIZE='4096'
$env:LOKLM_RETRIEVAL_TRACE='1'
pnpm.cmd exec playwright test --config tests/e2e/playwright.config.ts chat-gpu-handoff
```

The existing handoff smoke verifies one known answer plus lifecycle recovery. It is not the six-question quality sample. For indexing, set `LOKLM_TEST_PDF` to an absolute fixture path and run `indexing-native` with the same Playwright config. Reranker policy Off for the planned sample must be set explicitly in its isolated settings; the existing handoff smoke itself requests reranking and is governed by the runtime hardware policy.
