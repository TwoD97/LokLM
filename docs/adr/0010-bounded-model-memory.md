# ADR-0010: Bounded model memory and native reloads

**Status:** accepted

## Context

On a GTX 1050 Ti with 4 GiB VRAM, startup placed the embedder and reranker on the
GPU even when CPU placement was requested. Chat then failed every bounded
context allocation. Retrying cache types without reducing GPU weights did not
free enough space. A separate real-model test reproduced a native access
violation when unloading a used chat context with node-llama-cpp 3.18.1.

## Decision

Bundled inference requires a working GPU. CPU-only placement and silent CPU
fallback are disabled; legacy CPU preferences migrate to automatic GPU placement.
On cards with up to 6 GiB VRAM, the active task owns the GPU: chat allocations
are released before embedding or reranking loads, and the selected models are
retained as configurations for automatic reload. Larger cards keep models
resident when the estimated working memory fits; allocation failure evicts
inactive models and retries on GPU once. A model that still cannot fit reports
an actionable error. Partial chat layer offload to RAM remains possible, but
zero GPU layers are rejected.

A main-process indexing lease covers complete imports and backfills, including
parsing and all embedding batches. Chat and reranking requests wait outside the
native FIFO while indexing owns it, so they cannot deadlock that queue or reload
chat between embedding batches. The last lease schedules chat restoration;
adjacent queued documents share ownership. Cancellation, errors and shutdown
release leases. Empty backfills do not load models. Restoring chat refreshes its
actual context plan and idle timer, and parked models are not idle-unloaded.

A global loading dialog shows preparation, chunk progress and chat restoration.
It can be minimized to continue browsing or stop indexing at the current batch
boundary. Model status distinguishes availability from residency. Conversations
remain in the vault; reloaded chat rebuilds its prompt from persisted history.

Bundled indexing/backfill use four passages per batch, with a single-passage
first batch. Automatic chat context is capped at 8192 tokens on constrained
GPUs and bounded at 4096 tokens or more. Allocation retries reduce offload but
never finish with CPU-only inference. Small GPUs omit the optional second
utility context. Resource probes refresh between model loads.

The inference backend reserves 1–1.2 GiB VRAM, and successful loads report the
actual context and placement. Chat sessions own their sequences and release
them before their native contexts.

Update node-llama-cpp to 3.21.1, retaining the packaged Electron binary-loading
patch. Its [native context cleanup](https://github.com/withcatai/node-llama-cpp/blob/v3.21.1/llama/addon/AddonContext.cpp)
separates worker-thread memory disposal from main-thread bookkeeping. The old
version's crash reproduced with chat alone; the updated version completed the
same inference, unload, reload and inference sequence on this machine.

## Consequences

Small GPUs trade model-switch latency for usable GPU inference. Chat can use
more GPU memory between indexing jobs, while embeddings and reranking get their
own GPU allocations. Models that cannot run on the selected GPU fail clearly.
Reloading chat after indexing takes time and remains visible in the loading
screen. Explicit context choices still apply within available memory.

`pnpm test:models` builds and runs the real Standard models in an isolated
Electron worker, in both startup orders. It verifies embeddings, ranking,
translation, automatic chat restoration after retrieval, reload, and explicit unloads.
Results with timings and memory snapshots go to `out/model-residency-*.json`.
This is an opt-in hardware smoke test, not a translation quality benchmark.

The opt-in `tests/e2e/indexing-native.spec.ts` imports the PDF selected through
`LOKLM_TEST_PDF` into a temporary vault and verifies live chunk progress, ready
status, one durable vector per chunk, and automatic chat restoration. A second
run stops indexing through the UI and verifies chat is restored after cancellation.
It does not modify the source PDF or open the user's existing vault.

Automatic conversation titles are opportunistic: 48 output tokens, no reasoning,
isolated title instructions, and a 30-second cancellation deadline. Titles do
not reload parked chat, do not queue behind active work, and yield to chat,
translation, retrieval or indexing. Raw utility generations have a finite
default token budget and disable reasoning unless explicitly requested. Worker
logs identify utility/title execution and time spent waiting in its FIFO.
`LOKLM_NATIVE_CHAT=1` enables `tests/e2e/chat-gpu-handoff.spec.ts`, which verifies
real retrieval-to-chat inference and indexing interrupting a background title.
