# Native model co-residency: investigation, not an enabled policy

The current GTX 1050 Ti / Vulkan calibration does **not** justify retaining chat and embeddings together. Keep the existing exclusive policy on constrained GPUs. No co-residency implementation or additional GPU experiment was performed for this investigation.

## What the recorded baseline shows

Source: `tests/evals/native-calibration/reports/dev-4k-baseline/raw.json`, inspected while the DEV run was still progressing through its first eight questions. These are sampled whole-device memory values, not per-process allocations and not guaranteed instantaneous maxima. Later samples may change the final run maximum.

The log clock is Europe/Berlin (UTC+02:00 on 2026-09-24); `gpuSamples.at` is UTC. Query phase boundaries use worker log timestamps. The prefill/decode boundary is approximate: the first `Preparing embedder` timestamp plus the query's recorded `ttftMs`, differing from the browser's request start by a few milliseconds.

| DEV case | Chat prefill sampled maximum (MiB) | Chat decode sampled maximum (MiB) |
| -------- | ---------------------------------: | --------------------------------: |
| 01       |                               3353 |                              3352 |
| 02       |                               3373 |                              3371 |
| 03       |                               3370 |                              3370 |
| 04       |                               3376 |                              3374 |
| 05       |                               3388 |                              3376 |
| 06       |                               3379 |                              3384 |
| 07       |                               3420 |                              3552 |
| 08       |                               3427 |                              3410 |

The 3552 MiB sample at **15:30:10.254Z** is inside DEV-07 chat **decoding**. Its `llm.ask start` is 15:29:11.623Z, first output is approximately 15:29:34.752Z, and completion is 15:30:43.690Z. Thus it is neither an embedding allocation nor a prefill-only transient. At that sampled peak only 544 MiB remained on the 4096 MiB card.

The approximately 2208 MiB reading is **not a reliable chat-idle footprint**: for example, 2208 MiB at 15:21:02.863Z occurs during embedding loading, immediately before `embedder ready` at 15:21:03.046Z. DEV-03 and DEV-07 happened to capture the roughly 0.22-second embedding inference window at 2488 and 2495 MiB, about 300 MiB above the embedding weights stage. Most query embedding windows contain no sample because the polling interval is approximately 1.5 seconds. These two observations cannot establish a safe upper bound for long passages or bulk indexing.

After chat release, DEV-01 through DEV-07 generally fall back to roughly 1560–1620 MiB during model-loading gaps. DEV-08's gap is roughly 1723–1731 MiB, suggesting some of DEV-07's increase remained outside the currently loaded model (other applications, driver allocations, or other retained resources). Whole-device telemetry cannot identify its owner, so this is not evidence of a LokLM memory leak.

The current ~0.9 GiB observed incremental embedding footprint would already exceed chat's 544–761 MiB observed remaining capacity, before allowing any safety reserve. Simply adding the 639,150,592-byte GGUF file size to an idle reading is inadequate.

## Pinned library evidence

This review inspected the installed `node-llama-cpp` **3.21.1** source rather than assuming the latest online API matches the running binary.

- `dist/gguf/insights/GgufInsights.d.ts:57` and `:80` expose pre-load V2 estimates for model weights and a context, including `contextSize`, `modelGpuLayers`, `batchSize`, `sequences`, and `isEmbeddingContext`.
- `GgufInsights.js:876` accepts the existing `Llama` instance. Omitting it creates a slim fallback without the GPU backend; a meaningful device estimate must reuse the actual pinned backend.
- `GgufInsights.js:208` and `:530` implement the public V2 estimators. They attempt native simulation, **catch failures, and silently return heuristic estimates**. The public return type does not expose whether simulation or fallback produced the result. Therefore these are useful predictions, not a proven runtime upper bound.
- `GgufInsights.js:928` creates a simulated context using the specified batch, embedding mode, and KV settings; `:964` reads its memory breakdown, then disposes that context. `:1048` creates its simulated model with `noAlloc: true`. The addon maps that flag to `LLAMA_LOAD_MODE_NONE` (`llama/addon/AddonModel.cpp:476`).
- `llama/addon/AddonContext.cpp:798` sums reported context and compute memory. Driver/global allocations and changing desktop usage are not thereby bounded. The deprecated heuristic explicitly documents approximate graph overhead (`GgufInsights.d.ts:65`).
- `AddonContext.cpp:380` assigns the requested batch to both native batch and microbatch. Changing 128 to 256/512 changes the working allocation; it is not an innocuous estimator parameter.

Use the app's **actual Vulkan embedding configuration: one 2048-token context, batch 128**. CUDA/Metal's up-to-three-context pool is a different budget. Existing Vulkan batch safeguards must remain intact.

## Why a future experiment needs more than a free-memory check

The worker serializer already prevents simultaneous chat and embedding inference. `ModelResidency.load` can retry a recoverable allocation failure once after evicting other models. `ensureResident` reuses an already resident model, so retaining both could remove reload latency in principle. However, its early return does not currently recheck changing GPU pressure, and an inference-time native failure does not pass through the allocation retry. Native Vulkan device failures may terminate the worker rather than reject a promise.

A future explicitly enabled experiment should be asymmetric: retain an **already allocated chat model** only when adding the embedder. Always release embeddings before allocating/reallocating chat, otherwise its automatically selected GPU layer count can silently fall. Keep the serializer, GPU requirement, memory safety checks, and low-VRAM reranker policy unchanged.

Candidate admission inequality, subject to measurements rather than a shipping guarantee:

`fresh measured available >= full-GPU embedding weights estimate + one actual embedding context estimate + actual backend padding + max(256 MiB, 25% of estimated added footprint)`

Take fresh readings **after** estimates and immediately before allocation. For this Vulkan backend, measured available must conservatively respect both remaining process allocation budget and independently observed physical device headroom; `getVramState().free` alone is insufficient. The later candidate exposed materially different native-budget and whole-device readings; see the [padding investigation](2026-09-24-native-vram-padding.md). Do not subtract already observed model allocations a second time. Reject unknown, invalid, or zero-GPU estimates. The extra margin is an intentionally conservative experimental choice, not a library guarantee. Because public V2 can silently fall back to a heuristic, stronger admission should also require a previously measured peak for this exact model/backend/context/batch combination, with a long-passage stress case.

If a recoverable allocation error occurs, dispose partially allocated embedding resources, disable co-residency for the rest of the worker lifetime, and perform at most one exclusive retry. Repeatedly attempting the same failed arrangement recreates the load loop. Recheck pressure before reusing both models; release the idle model when headroom is insufficient. Abort the candidate on native inference errors rather than retrying indefinitely. These additions have **not** been implemented.

The next useful test is the separately authorized padding sweep with exclusive residency held constant. Compare per-phase GPU peaks, selected chat layers, allocation failures, first-token latency, total latency, and quality on the same DEV cases. Do not combine a lower padding reserve and a new residency policy in the same comparison.
