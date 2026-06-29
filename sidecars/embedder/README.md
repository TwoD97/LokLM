# loklm-embedder sidecar (PyTorch, Pro/NVIDIA)

High-throughput batched text embedding for the **Pro** tier on **NVIDIA** GPUs.
Replaces node-llama-cpp **only for embedding** — the chat LLM and reranker stay
on llama.cpp.

## Why

llama.cpp embeds one sequence per decode and caps at ~6–11k tok/s on an RTX 5090
(GPU idles at ~175 W of 575 W) — measured 2026-06-29, and the cap is the engine,
not the card (it never forms large fused batched GEMMs). PyTorch fp16 +
sentence-transformers with SDPA hits **~74k tok/s** on the same model/GPU (~12×),
so bulk indexing a large corpus drops from ~12 h to under an hour.

Measured throughput (Qwen3-Embedding-0.6B, fp16, RTX 5090):

| engine | tok/s |
|---|---|
| node-llama-cpp / llama.cpp (any config) | 6–11k |
| PyTorch fp16, batch 16 | 74k |

## Protocol

Newline-delimited JSON (NDJSON) over stdin/stdout, identical idiom to the
translator sidecar (`sidecars/translator`, `TranslatorSidecar.ts`). The main-side
client is `src/main/services/embeddings/EmbedderSidecar.ts`.

- ready handshake (stdout):   `{"ev":"ready"}`
- fatal load error + exit:    `{"ev":"fatal","error":"..."}`
- request:                    `{"id":N,"op":"...",...}`
- response:                   `{"id":N,"ok":true,...}` / `{"id":N,"ok":false,"error":"..."}`

Ops: `embed` (`{texts,batch_size,normalize}` → `{vectors:[[...]|null,...]}`, null
for empty inputs — same `Array<number[]|null>` contract as
`ModelsWorkerClient.embedderEmbed`), `ping`, `shutdown`. The process exits when
stdin closes, so a dead parent can't leave a torch process holding VRAM.

Passages/queries arrive **already prepared** (the query instruction / passage
prefix is applied by `EmbeddingService`), so vectors stay in the same space as
existing node-llama-cpp ones (same model; fp16 vs Q8 cosine-match >0.99).

## Enabling it (gate)

`pytorchEmbedderGate.ts` turns the sidecar on when **tier === 'pro'** AND the GPU
is **NVIDIA** AND the sidecar (python + script) resolves on disk. Even when on, a
failed start or mid-session crash transparently falls back to the node-llama-cpp
embedder.

- `LOKLM_PYTORCH_EMBEDDER=1` — force on (dev / no-marker boxes).
- `LOKLM_DISABLE_PYTORCH_EMBEDDER=1` — force off everywhere.
- `LOKLM_EMBEDDER_PYTHON` / `LOKLM_EMBEDDER_SCRIPT` — explicit interpreter/script.
- `LOKLM_EMBEDDER_CUDA_INDEX` — physical GPU index (CUDA_VISIBLE_DEVICES).
- `LOKLM_PYTORCH_EMBEDDER_MODEL` — override model id/path.

## Dev setup

The sidecar needs a Python with `torch` (CUDA build) + `sentence-transformers`.
Blackwell (RTX 50xx, sm_120) requires **cu128** wheels (torch ≥ 2.7):

```bash
python -m venv sidecars/embedder/.venv
sidecars/embedder/.venv/Scripts/pip install torch --index-url https://download.pytorch.org/whl/cu128
sidecars/embedder/.venv/Scripts/pip install sentence-transformers
# then: LOKLM_PYTORCH_EMBEDDER=1 npm run dev
```

`resolveEmbedderSidecar()` auto-discovers `sidecars/embedder/.venv`. Alternatively
point `LOKLM_EMBEDDER_PYTHON` at any torch-capable interpreter.

## TODO — follow-ups before shipping

These are NOT done in this branch (they're packaging / pipeline work):

1. **Packaging (Pro installer only).** Bundle a Python runtime + torch + the model
   under `resources/embedder/` (electron-builder `extraResources`, tier-conditional)
   and wire `verify-manifests` / the MinIO payload. Footprint ≈ 4.7 GB venv + 1.2 GB
   model (≈ 1 GB trimmable: drop unused `cusparse`/`cufft`/`cusolver`). Consider
   ONNX Runtime (~half the size) as a lighter alternative.
2. **Indexer batching (load-bearing for the 12×).** The throughput win needs the
   indexer to call `embedPassages` with **large arrays (256+)**. Today it feeds
   small per-document batches — leave that and you keep llama.cpp-era throughput
   even on the sidecar. See `indexInBackground`.
3. **Install-local model cache.** Pass `hfHome` (a models subdir) into
   `pytorchEmbedderConfig` so the model isn't fetched into `$HOME`.
4. **Wire status into the renderer** (device chip / embedder source = "PyTorch").
5. **base64 float32 frames** instead of JSON arrays for lower IPC overhead on
   very large batches.
6. **AMD/Intel Pro + CPU**: stays on llama.cpp (no usable torch-ROCm on Windows).
