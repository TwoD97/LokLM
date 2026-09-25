# RAG research and implementation roadmap — 24 September 2026

LokLM can improve substantially through better evidence handling before it needs another model. The immediate priorities are context budgeting, hybrid ranking correctness, and PDF structure. Keep GPU inference and the current exclusive-residency policy; keep the optional reranker disabled on the 4 GB target.

This review combines three parallel audits of current code, evaluation assets, and primary research, plus inspection of document ingestion. Findings below distinguish reproduced implementation problems from proposed experiments. This research changed no production code, loaded no models, and uploaded no private documents. No end-to-end quality or speed improvement is claimed yet.

## 1. What the current implementation actually does

The application already has lexical BM25 and dense search, reciprocal rank fusion (RRF), query decomposition, document diversity, code-aware retrieval, document-summary/inventory routing, pinned sources, and citation reconciliation. Replacing this with a new RAG framework is not the first priority.

The default chat setting requests 10 hits. On constrained hardware this normally produces a 20-candidate pool, with a maximum of 32. LLM query expansion, query translation, and whole-document expansion are disabled by the lean defaults. PDF/prose chunks default to 2,000 **characters**, with 200-character overlap. The actual resolved model context, which has been 4,096 or 8,192 in local runs, matters more than a requested 32,768-token target.

These resource defaults avoid extra model handoffs. However, several interactions weaken the evidence that reaches the answer model.

## 2. Reproduced correctness problems — first implementation batch

All examples below exercised actual TypeScript functions with synthetic data or mocked providers. They did not run native inference.

| Priority | Finding and evidence                                                                                                                                                                                                                                                                                                                                         | Required change                                                                                                                                                                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | `answerMaxTokens` reserves at least 4,096 output tokens even when the entire context is 4,096. With the German prompt, a small query, and the safety margin, the reproduced evidence budget was **−1,079 tokens before history**. At 8,192 it was approximately 3,010. See `src/main/services/llm/prompt.ts:78` and `src/main/services/qa/QAService.ts:452`. | Allocate output, history, instructions, framing, and evidence together using the actual context. Bound total history. Use tokenizer counts where available. Keep generation's output limit consistent with this allocation. This proves faulty estimated budgeting, not a reproduced native overflow. |
| P0       | `packHitsToBudget` always keeps the first hit and stops at the first later hit that cannot fit. A lone 8,000-character hit survives a negative budget. Given a short primary hit, oversized neighbor, and another short primary hit, the last primary is discarded even when both primaries fit. See `prompt.ts:98`.                                         | Deduplicate pinned/retrieved evidence, prioritize primary support, skip candidates that do not fit, and add neighbors only within the remaining budget. Handle a single oversized hit explicitly without misrepresenting truncated evidence. Enforce one final prompt budget.                         |
| P0       | Without reranking, BM25 has weight 2 and dense search weight 1. With 20 disjoint results in each list and a 20-candidate cap, **zero dense-only results survive**. The lowest lexical contribution, `2/(60+20)`, exceeds the highest dense-only contribution, `1/(60+1)`. This also holds at the lean maximum of 32. See `RetrievalService.ts:471`.          | Evaluate balanced weights and protected lexical/dense candidate coverage. Repair this before judging cross-language embedding quality or adding query translation. A quota is an experiment, not an assumed optimal constant.                                                                         |
| P0       | RRF truncates the accumulator after each arm/variant, losing contributions from discarded candidates. With arms `[1,2]`, `[3,4]`, `[2,5]` and cap 2, current fusion returns `[1,3]`; summing all contributions first makes document 2 the consensus winner. See `src/main/services/retrieval/rrf.ts:28`.                                                     | Aggregate contributions across all bounded input lists, then apply the final cap once. Add an arm-order invariance check.                                                                                                                                                                             |
| P1       | Ollama reports `gpu: null` while its capability method reports that it is not CPU inference. A separate retrieval heuristic interprets the missing GPU label as CPU. An actual-service mock used 20 candidates; an explicit override used 40. See `RetrievalService.ts:737` and `providers/ollama/OllamaLlmProvider.ts:159`.                                 | Use provider capabilities and centralized hardware policy rather than a local GPU label.                                                                                                                                                                                                              |

There is no later application-level evidence repacking that fixes the first two problems. `LlamaService.ts:897` renders the supplied hits; its overflow retry removes history. Pinned documents can also duplicate retrieved passages and independently retain an oversized first chunk.

The earlier [RAG review](../ux/2026-09-24-rag-review.md) correctly identified unavailable/failed reranker fallback problems, which were fixed. This deeper review finds a separate problem in the resulting lexical-weighted fallback. A successful fallback does not establish that its weights are suitable.

## 3. Better document understanding — highest-value ingestion experiments

PDF extraction currently produces page text and bookmark-derived section metadata. Section tags do not become a search-context prefix for ordinary PDFs. Code already has a separate contextual prefix used for embeddings and indexing; extend that mechanism carefully to prose.

Start with deterministic source context: document title, full section path, explicit source date when present, and relevant table headers. Preserve original text and page provenance separately for citations. Avoid invented dates or descriptions. Weight repeated metadata so it does not overwhelm lexical scoring. Version the embedding input format and reindex consistently, including backfill; do not silently mix old and new vector representations.

Anthropic's contextual retrieval adds generated chunk context to both embedding and lexical inputs. It supports investigating context lost by isolated chunks. Our deterministic metadata proposal is a cheaper adaptation, not a reproduction of its whole-document LLM-generated method or its reported improvements. [Contextual Retrieval, Anthropic, 2024](https://www.anthropic.com/engineering/contextual-retrieval).

Preserve tables as relationships: row label, column header, year, value, and unit. Keep those together when splitting large tables. A retrieved value of “23.4” is inadequate if its year or unit was dropped. Audit reading order, captions, footnotes, and multi-column pages against rendered originals before tuning rankings.

Current OCR uses a near-empty-page threshold of 16 characters (`documents/ocr.ts:46`). A page with a native heading and an image containing its actual table can escape OCR. OCR failures are logged while original text remains, without a structured extraction-quality result. Introduce page-level coverage/warnings and a targeted retry path. OCR of chart labels alone does not establish plotted values or relationships.

Docling demonstrates structured conversion with layout and table reconstruction. Use it as an offline comparison candidate for difficult public fixtures; adoption requires packaging, memory, and latency measurements. This is not a recommendation to add a mandatory Python sidecar or another resident model. [Docling Technical Report, 2025](https://arxiv.org/html/2501.17887v1).

Compare paragraph/section-aware chunk boundaries and several token-bounded sizes. Do not declare a universal chunk size. Retrieve precise passages, then add bounded parent-section or neighboring context only when necessary. Preserve each subquestion's evidence in comparisons rather than allowing one document to consume the prompt.

## 4. Answer support, abstention, and query intent

Currently, a lexical match can bypass the dense relevance floor, the pipeline tries to retain at least one result, and the default refusal threshold is zero. Positive RRF scores are ranks, not evidence that a source answers the question. Retain lexical coverage, exact entity/number matches, dense strength, and agreement signals for evaluation; calibrate any answerability rule on answerable and unanswerable cases.

Measure whether the **final supplied context contains enough evidence**, after packing. A relevant passage may still lack the requested date, unit, comparison, or exception. Research on sufficient context separates missing evidence from generation failure; strong-judge results do not establish that our small local model can reliably judge itself. [Sufficient Context, ICLR 2025](https://arxiv.org/abs/2411.06037).

Citation reconciliation currently checks marker membership against supplied hits. That is useful provenance validation, but it does not verify that the cited passage supports the particular claim. Evaluate citation correctness and completeness separately, with exact numbers/units and contradictory sources represented. [ALCE, EMNLP 2023](https://aclanthology.org/2023.emnlp-main.398/). Claim-level retrieval/generation diagnostics provide a useful evaluation pattern without requiring another runtime service. [RAGChecker, 2024](https://arxiv.org/abs/2408.08067).

The app already has focused/broad/summary routing, but chat supplies a configured `topK=10`, bypassing the adaptive 3/8/12 choice. Unconditional document round-robin can also elevate a weak different-document passage over a second decisive passage. Distinguish focused lookup, comparison, summary, and inventory questions; use relevance-constrained diversity and subquestion coverage.

Only after these changes, test one bounded recovery step for identifiable evidence gaps: a refined search or section expansion, followed by an answer or an explicit limitation. Propagate cancellation into query expansion and translation first; their extra LLM calls currently lack the request signal. Adaptive-RAG supports testing complexity-dependent effort, but its trained routing approach is not equivalent to adding handwritten heuristics. [Adaptive-RAG, NAACL 2024](https://aclanthology.org/2024.naacl-long.389/).

For future notes/calendar/todo search, keep dates, completion state, and counts available as structured filters/queries. Embeddings alone should not answer “Which overdue tasks remain?”

## 5. Which advanced techniques fit this machine?

| Technique                                                   | Decision for the 4 GB default                               | Reason and transfer limit                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hybrid search, deterministic chunk context, careful packing | Prioritize                                                  | Repairs and experiments require no additional inference model. Measure accuracy, especially cross-language and exact identifiers.                                                                                                                                                                                                                                                   |
| Cross-encoder reranking                                     | Keep off                                                    | An additional scoring model adds loading and inference cost. Test on supported larger GPUs using identical candidates and timings that include swaps. Multilingual capability does not prove suitable local latency. [Official BGE reranker card](https://huggingface.co/BAAI/bge-reranker-v2-m3).                                                                                  |
| Late chunking                                               | Defer                                                       | The published method uses token representations and mean pooling after long-context encoding. Current Qwen3-Embedding uses last-token pooling, so this is a model/runtime and index migration, not a setting. [Late Chunking](https://arxiv.org/html/2409.04701v3), [Qwen pooling configuration](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B/blob/main/1_Pooling/config.json). |
| GraphRAG                                                    | Reserve for demonstrated collection-wide synthesis failures | Its entity/community summaries address global questions over large corpora. That does not establish better numeric lookup or 4 GB performance. First test source coverage and bounded document summaries. [GraphRAG](https://arxiv.org/abs/2404.16130).                                                                                                                             |
| Always-on generated queries, HyDE, self-critique loops      | Defer                                                       | Extra inference can cause repeated GPU handoffs. Test conditional effort only after fixing the ordinary path.                                                                                                                                                                                                                                                                       |
| Larger embedding/chat models or visual retrieval            | Separate experiments                                        | Freeze the current model baseline first. A smaller fully GPU-resident chat model may be worth comparing with the current partial offload, but fit, answer quality, and speed must be measured together. Visual evidence needs separate chart/table evaluation.                                                                                                                      |

A 2026 study of 14 retrievers across 12 BRIGHT tasks found substantial variation in the value of larger models and reasoning augmentation, and weak raw-score prediction of retrieval success. Its hardware and workloads differ from LokLM. The practical lesson is to measure indexing cost, cold/warm latency, robustness, and accuracy together; its latency numbers cannot predict this GPU's performance. [Are LLM-Based Retrievers Worth Their Cost?, SIGIR 2026](https://arxiv.org/abs/2604.03676).

Keep ordinary queries to query embedding/retrieval followed by a single handoff to chat where residency requires it. Evaluate query-embedding caching with model/input/index-version keys. Scope cached retrieval results to the workspace and document selection. Report actual GPU layers/context; partial offload is not full GPU residency.

## 6. Existing evaluations do not yet establish current app quality

The repository contains useful German/English datasets, answerability cases, and code evaluations. However:

- The general `tests/evals/sweep.ts` uses its own dense retrieval path, bypassing production hybrid retrieval, routing, refusal logic, GPU coordination, and QA context packing.
- Its LLM bridge supplies selected hits directly; the judge does not see production's actual post-packing evidence. Chunker configuration labels do not rechunk the supplied corpus.
- Model warmup precedes measured queries, and generation timing excludes retrieval/model handoffs. Those timings are not click-to-answer latency.
- The June 7 answer-model report used a 32 GB GPU, CPU BGE embeddings, and a separate 24B judge. Its raw answer-run directory is absent in this checkout.
- The committed June 25 code report records R@5 of 0.777 without reranking versus 0.491 with reranking for its `all_fixes` configurations. This is historical English code retrieval evidence, not proof of current prose quality.
- The 80 answerability cases and 15 holdout cases have validators, but no executed answer-evaluation runner was found. The small holdout shares the sample-document family.
- `pnpm evals:run` uses fake models; two scale-related scripts point to missing paths. Code caches need corpus-content hashing to prevent stale comparisons.

The agent ran the existing eval-case, judge-prompt, pinned-budget/prompt, and code-heuristic unit suites: **432 tests passed**. These validate mechanics and data, not answer quality. The reproduced defects above remain despite those passing suites.

## 7. Concrete experiment and release plan

Capture a production baseline before changing defaults. Use the existing native app harness; extend it to record the exact candidate IDs, final supplied passages, answer, citations, timings, actual context, and model residency events. Avoid logging private source text to external services.

Start with 24 development and 24 held-out questions, balanced German/English, using different source documents across the two sets. In each set include four cases each for dates/numbers, tables, cross-language search, paraphrase/multi-source questions, no-answer/partial-answer questions, and code. Include scanned/mixed-layout pages, a chart case, follow-ups, and conflicting sources within these categories. Human-review the gold answers, source pages, required facts, and units. Existing sample documents can seed development; they must not double as the held-out corpus.

Freeze model files/quantization, embedding input version, settings, corpus hash, and actual resolved context. Compare supported 4,096 and 8,192 contexts, with the reranker off. Do not label a requested 8,192 run as such if the runtime resolves less. Apply changes separately:

1. **A — Baseline:** current production behavior, including known defects.
2. **B — Packing:** bounded output/history, deduplication, primary-first evidence selection.
3. **C — Fusion:** full accumulation before truncation; compare balanced weighting/coverage against B.
4. **D — Source context:** deterministic title/section/table context with a clean reindex.
5. **E — Extraction/selection:** targeted PDF fixes and bounded parent-section expansion, separately ablated.
6. **F — Conditional effort:** one evidence-recovery step only if remaining failures justify it.

For each stage measure retrieval recall/nDCG, required-fact coverage **after packing**, grounded answer correctness, citation support/completeness, false refusals, and unsupported answers. Report category-level counts and paired changes, not an impressive aggregate alone. Keep answer coverage alongside accuracy so refusing everything cannot appear to win.

Measure click-to-first-visible-token and click-to-final-answer, separating model switching, embedding, retrieval, prompt evaluation, and generation. For six representative questions, collect three fresh-process runs and three warm repeats; show p50/p95 cautiously with sample counts. Record peak VRAM, indexing duration, cancellation latency, and resolved GPU layers. These small samples guide engineering; they do not establish universal performance.

Release gates: no hangs/OOM/empty-success answers; no citation IDs outside supplied evidence; no new critical date/unit/number errors; no newly unsupported answers on the fixed no-answer set; and no unexplained held-out regression. Review grounding manually until an automated judge is calibrated. Publish measured quality/latency tradeoffs before changing defaults.

## 8. Product behavior that follows from the evidence

Use clear phases such as “Searching your documents” and “Preparing the answer,” with cancellation propagated through both. Explain a GPU handoff once rather than presenting repeated initialization as a loop. Show page/section and supporting text when a citation opens. Flag incomplete extraction on affected documents and distinguish “no supporting source found” from “document still indexing.”

Do not display retrieval similarity as an answer-confidence percentage. When evidence supports only part of a question, answer that part and identify what is missing. When a collection-wide answer covers only selected documents, make that scope visible.

The first implementation batch should be the four P0 fixes plus production-path tracing and regression cases. Source-structure improvements follow with reindexing and paired evaluation. These are concrete, testable steps toward a more reliable app on the existing hardware.
