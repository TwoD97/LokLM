# ADR-0007: Lite tier — iGPU/low-end performance preset

Status: Accepted (staged implementation) — reranker-off + leading-slice rerank levers superseded by ADR-0008 (2026-06-28)
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

| Lever                                     | Lite                                                                | Where                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Query expansion (`multiQuery`)            | **off**                                                             | `chat:stream` handler                                                        |
| Whole-doc expansion (`wholeDocFallback`)  | **off**                                                             | `chat:stream` handler → QAService → searchOpts                               |
| Follow-up `contextualize`                 | **heuristic** (`heuristicContextualizeQuery`, no LLM)               | QAService                                                                    |
| LLM context window                        | **hard-capped 8 K** (regardless of profile/Auto/persisted setting)  | `LlamaService.performLoad`                                                   |
| Reranker ~~(off)~~ → **on**, see ADR-0008 | ~~hidden in UI + not warmed~~ → bundled, warmed, shown on all tiers | `WarmingView` / `models:warmupForQa`, `installer-wizard/model-manifest.json` |

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

### Measured: reranker latency on an iGPU (non-lite tier)

The reranker is **off on lite** (table above), but a **standard/pro install on an
iGPU still reranks the whole pipeline** — and the live app surfaced it as a
`Reranken — 40 reranked — 66.26 s` stage row for a single short query
("Was ist ein Interpreter?"). Benchmarked against the bundled
`bge-reranker-v2-m3-Q4_K_M.gguf` at the app's `RERANK_CONTEXT_SIZE` (1024) on the
worker's Vulkan backend (same call path as `modelsWorker.rerankerRank` →
`createRankingContext` → `rankAll`):

- **The 66 s was a cold start, and the bench reproduces it.** One-time load is
  `getLlama(vulkan)` ~3.9 s + `loadModel` ~6.4 s + `createRankingContext` ~0.1 s
  ≈ **10 s**, and the **first** `rankAll` also pays a one-time Vulkan shader
  compile. Cold first-rank of 40 candidates ≈ **59 s**; load + cold-rank ≈ the
  observed **66 s**. A **warm** 40-candidate rerank dropped to **~24 s**.
- **Per-candidate cost is not stable enough to quote.** Across 8/16/24/40
  candidates the warm cost/chunk bounced 0.6–3.1 s and was **non-monotonic**
  (warm-16 came out _slower_ than warm-40; cold-24 slower than cold-40) — the
  signature of **thermal throttling / shared-iGPU contention**, not of candidate
  count. The iGPU does not hold a steady clock long enough to measure a clean
  curve.
- **The cost driver is that the whole candidate pool is reranked**, not the
  top-K (`RetrievalService.maybeRerank` scores every fused candidate — deliberate,
  so diversification sees reranked-quality candidates from every doc).

Levers (none free): (a) **keep the reranker warm** — the ~10 s load + first-call
shader compile are one-time, so a resident model never re-pays the 66 s;
(b) **cap the rerank input** to ~top-12–16 candidates (loses some "every doc
represented" benefit); (c) **tier-gate it off** (what lite already does). Same
methodology lesson as #1 below: the _cold_ app path is the honest number — the
warm bench (~24 s) understates first-query latency by ~3×.

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
- **Reranking on an iGPU is a cold-start cliff** (~66 s for 40 candidates cold,
  ~24 s warm — see the measured block above). A non-lite install on an iGPU pays
  it on the first query. Levers: keep the reranker warm, cap the rerank input to
  ~top-12–16, or tier-gate it off. A measured "perf class" probe (below) would let
  standard/pro auto-trim this on weak hardware.
- **Changing the "Kontextgröße" setting does not reload the model** — it only binds
  at load. Consider reloading the LLM on a context-choice change (mirrors placement).
- **Coarse chunking** of multi-Q&A study sheets means one chunk holds several Q&As.
  Finer chunking would make retrieval precise even with whole-doc expansion on.
- The lite preset is **tier-gated**, not hardware-gated. A standard/pro install on
  an iGPU still gets the heavy pipeline. A measured "perf class" (a warmup
  throughput probe at load) would generalize this beyond the install tier.

## Root cause of the iGPU crashes/hangs — the Vulkan submission watchdog (0.6.2)

This closes the long "AMD iGPU Vulkan instability" saga (the `0xC0000409` /
`ErrorDeviceLost` reverts in the git history: `210b175 → a52d652 → 07d8921 →
c34435e → 69b891b → 01d0705`). Those changes chased process topology, VRAM, and
`disableHardwareAcceleration` — all of which **mis-diagnosed** the problem. The
actual root cause, found in 0.6.2 by benchmarking instead of theorising:

**ggml's Vulkan backend batches ~100 compute-graph nodes per `vkQueueSubmit`,
and on a slow integrated GPU a single large submission can exceed the OS
GPU-job timeout (~2 s TDR on Windows / `amdgpu.lockup_timeout` on Linux). The
driver then resets the device** (`vk::Queue::submit: ErrorDeviceLost`) **or the
native `session.prompt` never returns (a hang).** Upstream: llama.cpp
[#21724](https://github.com/ggml-org/llama.cpp/issues/21724) (the
`nodes_per_submit=100→1` finding, "no perf regression") and
[#20515](https://github.com/ggml-org/llama.cpp/issues/20515) ("sensitive to
ubatch-size and context length").

Two symptoms, one cause:

- **Embedder, during folder sync** → `ErrorDeviceLost` from passage ~14 on, every
  subsequent embed dies.
- **LLM prefill, during chat** → `session.prompt` hangs; `[qa] prefill input`
  logs but no generation ever follows (the intermittent "blank answer").

**Why it only fires in the packaged app, and only on an iGPU.** A benchmark
(`tests/bench/vulkan-lite-embed.ts`) loads the lite models on the iGPU's Vulkan
backend and bulk-embeds 300 passages + interleaves chat/rerank with all three
models resident — and **never** loses the device (19 GB iGPU, 15 GB free
throughout; 3.7 emb/s). So it is **not** VRAM, **not** co-residency, **not** the
model. The only consumer the bench lacks is **Electron's own GPU process
compositing the UI on the same iGPU** — that second consumer steals GPU cycles
and slows each worker submission _past_ the watchdog. A **dedicated** GPU is far
too fast for any single submission to approach the ~2 s limit, so it never
triggers there — the crash is structurally iGPU-only.

**Fix (0.6.2): cap the Vulkan submission size, not the GPU.** Smaller batch →
smaller compute graph per submit → each finishes well under the watchdog even
while the compositor competes. In `modelsWorker`:

| Context     | Batch                                   | Note                                                                   |
| ----------- | --------------------------------------- | ---------------------------------------------------------------------- |
| Embedder    | **128** (`VULKAN_SAFE_BATCH`)           | throughput-neutral (3.70 vs 3.76 emb/s benched)                        |
| LLM prefill | **256** on iGPU, **1024** on CUDA/Metal | gated by `isFastDedicatedGpu(primaryGpuLabel)` — dGPU keeps full speed |
| Reranker    | full (default)                          | short per-chat burst, never hit the timeout                            |

Everything stays **on the GPU** (no CPU fallback) and the UI stays
**hardware-accelerated** (no `disableHardwareAcceleration`). Batch size does not
change total prefill time (~113 s for a 3.5 K-token prompt is the iGPU's
intrinsic 2B-prefill cost) — it only governs whether a piece trips the watchdog.

**Rejected on the way (0.6.2), recorded so it isn't re-tried:**

1. **`disableHardwareAcceleration()`.** Removes Electron's GPU compositor → the
   worker is the sole Vulkan consumer (the stable bench condition), so it _would_
   avoid the crash — but it forces **software UI compositing**, which made the UI
   slow/glitchy. The batch cap fixes the cause without sacrificing the UI.
2. **Embedder/LLM → CPU `aux` backend.** Stable, but needlessly slow, and the
   bench proved the GPU path is fine once submissions are bounded. A workaround
   for a problem we no longer have.
3. **`GGML_VK_NODES_PER_SUBMIT` env override (#21724).** Not present in the
   bundled `node-llama-cpp@3.18.1` build; `batchSize` is the available lever.
