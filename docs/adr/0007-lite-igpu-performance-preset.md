# ADR-0007: Lite tier — iGPU/low-end performance preset

Status: Accepted (staged implementation)
Date: 2026-06-27
Builds on: ADR-0004 (adaptive model residency), ADR-0003 (query routing / RAG pipeline)

## Context

The `lite` install tier targets **iGPU-only / low-end (8 GB) machines** (Intel/AMD
integrated GPUs). On that hardware the default RAG pipeline was unusable: a single
chat turn measured **TTFT 337–434 s and then crashed** (empty answer), and the
answer was often off-topic. Reference machine: Intel CPU + iGPU, ~17 GB unified
memory, Qwen3-4B (Q4_K_M) + bge-m3 embedder, all on the worker's shared Vulkan
backend.

Root causes (each verified against the live app, not a synthetic bench):

- **The iGPU lies about being a fast GPU.** node-llama-cpp latches **Vulkan** on the
  iGPU, so `RetrievalService.autoDetectCpuMode()` (which keys off the GPU label)
  reads it as a capable GPU and leaves the expensive stages **on**. The label
  cannot distinguish an iGPU from a discrete GPU.
- **Query expansion (multiQuery)** ran a full extra LLM generation _before_
  retrieval — ~87 s cold on the iGPU — and its paraphrases **drifted the topic**
  ("interpreter" → retrieved a JIT-compiler chunk → wrong answer).
- **`wholeDocFallback`** expanded a matched _small_ doc to the **entire document**.
  A multi-Q&A study sheet is one small doc, so the prompt was flooded with every
  Q&A and the model answered the wrong sub-question — and the prefill ballooned.
- **`Auto` context sizing.** "Auto" sizes the LLM context to _free VRAM_. On an
  iGPU's shared memory that resolved to the model's full **128 K** native window →
  a huge KV cache **and** a context budget so large the packer stuffed ~5 K tokens
  / 10 chunks into the prompt. That is what made prefill minutes-long and OOM'd
  the device.
- **LLM follow-up rewrite (`contextualize`)** was a _second_ full prefill+generation
  per follow-up turn.

## Decision

A **lite-tier preset**, gated on `getEffectiveTier() === 'lite'` (the reliable
signal — `LOKLM_TIER` / install marker — **not** the GPU label, and **not** the
persisted per-setting values, which a prior non-lite run can leave "wrong"):

| Lever                                    | Lite                                                               | Where                                             |
| ---------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------- |
| Query expansion (`multiQuery`)           | **off**                                                            | `chat:stream` handler                             |
| Whole-doc expansion (`wholeDocFallback`) | **off**                                                            | `chat:stream` handler → QAService → searchOpts    |
| Follow-up `contextualize`                | **heuristic** (`heuristicContextualizeQuery`, no LLM)              | QAService                                         |
| LLM context window                       | **hard-capped 8 K** (regardless of profile/Auto/persisted setting) | `LlamaService.performLoad`                        |
| Reranker                                 | hidden in UI + not warmed                                          | `WarmingView` / `models:warmupForQa` (tier-gated) |

Plus a **post-unlock loading screen** (`WarmingView`): staged checklist driven by
the live model-status pushes, **embedder loaded first** (it gates indexing +
retrieval; the LLM is the slow one), auto-advances on LLM+embedder ready with a
"Continue anyway" escape.

Diagnostic: `QAService` logs `[qa] prefill input: ctxWindow=… promptTokens≈… …`
on every turn so prefill cost can be traced to its cause (window not reloaded?
prompt still huge?) from real data instead of guessed at.

### Measured effect (reference machine)

|                           | Before            | After                                   |
| ------------------------- | ----------------- | --------------------------------------- |
| `ctxWindow`               | 131072            | **8192**                                |
| prompt tokens             | ~4900             | **~3300**                               |
| `multiQuery` / `wholeDoc` | on / on           | **off / off**                           |
| TTFT                      | 337–434 s + crash | bounded (no OOM); prefill is iGPU-bound |

## Trial and error — what we tried and REJECTED

Recorded so a future session does not re-derive these the hard way.

1. **Benchmark methodology error (the original sin).** The first perf bench _warmed_
   the model and used a _small, decode-capped_ prompt → reported an optimistic
   ~16 s TTFT and completely missed (a) the cold first inference (~87 s) and (b)
   the real packed-context prefill. **Lesson: benchmark the real, cold app path;
   a warm toy bench lies.** Later findings came from a `[qa]` log in the live app.

2. **`ModelLoadLock` — serialize ALL model loads. REVERTED.** Added to stop three
   concurrent native loads from thrashing the shared backend. But it serialized
   the _embedder_ load **behind** the slow LLM load, so indexing was starved of the
   embedder it needs → **"162 docs, 0 vectors, stuck indexing."** Replaced with
   **embedder-first ordering** in `models:warmupForQa` (cheaper, no head-of-line
   blocking). The `ModelLoadLock` class remains in the tree (with its tests) but is
   **unused**.

3. **GPU batch-embedding (`Promise.all` instead of the per-chunk loop). BENCHED,
   REJECTED.** Hypothesis: concurrent `getEmbeddingFor` lets the context batch
   multiple chunks per decode. Measured on the iGPU: **1.06×** (batchSize 512).
   The iGPU is **compute-bound** — one chunk already saturates it — so batching
   buys nothing. Not worth the over-context-crash risk.

4. **Embedder on CPU instead of the iGPU. BENCHED, REJECTED.** Hypothesis: the
   slow Vulkan embedder would be faster on CPU. Measured: **CPU 0.2 emb/s vs iGPU
   0.8 emb/s — CPU is 4× slower.** The iGPU is already the better device; bge-m3 is
   just inherently ~0.8 chunks/s here. The only real embedding speedup left is a
   _smaller/faster embedder model_.

5. **Capping context via the lite _profile_ `contextSize` alone. INSUFFICIENT.**
   `planLlm` clamps to `profileDefaultContext`, but only if the loaded profile
   resolves to `lite`. A **persisted `llmProfile`** (or Auto) can resolve to `full`
   (128 K), bypassing the cap. Fixed by capping on the **tier** in `performLoad`,
   independent of which profile resolved.

## Known floor / follow-ups

- **Prefill on an iGPU is inherently slow** (compute-bound). With the prompt bounded
  to ~3 K tokens it is survivable, but not instant. The only further levers are a
  _smaller LLM_ or a real GPU.
- **Embedding throughput** (~0.8 chunks/s) makes indexing large corpora slow. Lever:
  a smaller/faster embedder; batching and CPU were both ruled out above.
- **Changing the "Kontextgröße" setting does not reload the model** — it only binds
  at load. Consider reloading the LLM on a context-choice change (mirrors placement).
- **Coarse chunking** of multi-Q&A study sheets means one chunk holds several Q&As.
  Finer chunking would make retrieval precise even with whole-doc expansion on.
- The lite preset is **tier-gated**, not hardware-gated. A standard/pro install on
  an iGPU still gets the heavy pipeline. A measured "perf class" (a warmup
  throughput probe at load) would generalize this beyond the install tier.
