# loklm-translator sidecar

CPU-only machine translation for LokLM: [MADLAD-400-3B-MT](https://huggingface.co/google/madlad400-3b-mt)
(Apache 2.0 , 400+ languages) running on [CTranslate2](https://github.com/OpenNMT/CTranslate2)
int8 , tokenized with SentencePiece. A dedicated MT model because the bundled
Qwen tiers are Q4-quantized chat models — fine for DE/EN , unreliable on the
long tail of languages , and slower per sentence than a seq2seq int8 model.

## Why a sidecar and not node-llama-cpp

MADLAD is T5 (encoder-decoder). llama.cpp runs it under `llama-cli` only —
`llama-server` and the bindings (node-llama-cpp included) don't support
encoder-decoder models. CTranslate2 is the purpose-built MT runtime , but has
no Node bindings , so the smallest honest integration is this ~200-line exe
speaking NDJSON over stdio. The main process drives it via
`src/main/services/translation/TranslatorSidecar.ts` , same RPC-by-id idiom as
`ModelsWorkerClient`.

## Protocol

One JSON object per line , stdout answers stdin. Startup handshake first:

```
← {"ev":"ready","model":"<dir>"}                              on success
← {"ev":"fatal","error":"…"}                                  on startup failure , exit 1
→ {"id":1,"op":"translate","texts":["Hallo Welt."],"target":"en","beam":1}
← {"id":1,"ok":true,"results":["Hello world."]}
→ {"id":2,"op":"ping"}        ← {"id":2,"ok":true}
→ {"id":3,"op":"shutdown"}    ← {"id":3,"ok":true} , exit 0
```

Target languages are validated against the SentencePiece vocabulary (the
`<2xx>` token must encode as a single piece) , so an unsupported code fails
loudly instead of producing garbage. The process exits when stdin closes —
a dead parent must not leave a 3 GB orphan (Windows is bad at process trees ,
don't rely on kill alone).

## Build

```
pwsh scripts/build-translator-sidecar.ps1            # CPU (default)
pwsh scripts/build-translator-sidecar.ps1 -Cuda      # NVIDIA GPU build
```

Stages `dist/loklm-translator(.exe)` , which electron-builder ships to
`resources/translator/` (see `extraResources` in package.json). `dist/` is
committed empty (.gitkeep) so packaging without the sidecar still works — the
app then reports the translator as unavailable instead of failing the build.

Cold build fetches CTranslate2 (pinned tag in CMakeLists.txt) + SentencePiece
and takes 10-25 min. Versions are pinned in CMakeLists.txt; the CT2 API used
here is the v4.x `Translator(ModelLoader, ReplicaPoolConfig)` shape.

## CPU vs GPU

The sidecar picks its device at runtime from `--device auto|cpu|cuda` (the app
passes `auto`):

- **auto** — CUDA when a device is present AND ≥4 GiB VRAM is free (enough for
  the int8 3B model + buffers) , otherwise CPU. So a missing/small/busy GPU
  degrades cleanly instead of OOM-ing. The chosen device is reported in the
  `ready` frame (`"device":"cuda"|"cpu"`).
- CPU uses **physical** cores (not logical) — int8 GEMM is bandwidth-bound and
  hyperthreads slow it down (measured 8C/16T: 8 threads 4.4s vs 16 threads
  10.4s for one batch). Detection: Windows `GetLogicalProcessorInformationEx` ,
  macOS `hw.physicalcpu` , Linux `/proc/cpuinfo` physical/core-id pairs.

**GPU is NVIDIA-only** — CTranslate2 has no Metal or ROCm backend , so macOS
and AMD always run CPU (Apple-silicon NEON is the fastest CPU path). The `-Cuda`
build needs the CUDA Toolkit (nvcc) and bakes in compute capabilities via
`-DCUDA_ARCH_LIST=` (default `8.0;8.6;8.9+PTX` — native Ampere/Ada SASS plus
PTX). CT2 4.6.0 routes through the legacy `FindCUDA` arch path , whose
`select_compute_arch.cmake` (CMake ≤3.30) predates Blackwell — naming `12.0`
fails with "arch_bin wasn't set" , so the `+PTX` is how newer cards (Hopper ,
Blackwell) are covered : the driver JIT-compiles `compute_89` PTX at first launch.

### Shipping the GPU build (prebuilt-artifact model)

The CUDA binary (`loklm-translator-cuda`) dynamically links the CUDA runtime ,
so it will NOT start without the NVIDIA driver. It rides in the **same CUDA
archive the wizard already offers for the node-llama-cpp CUDA backend** — one
"GPU acceleration" choice (an install-time extra download) covers both the LLM
and translation. The base installer never carries it.

Because compiling CTranslate2 from source per-release is far too heavy
(10-25 min CPU , 30+ min CUDA , per platform) , the binaries are **prebuilt and
fetched** , the same way the GGUF model and node-llama-cpp binaries are:

1. **`.github/workflows/build-translator-sidecar.yml`** (manual / on sidecar
   changes) builds CPU + CUDA per platform and uploads to
   `minio/loklm-installers/translator-sidecar/<plat>/{cpu,cuda}/`. `-Cuda` stages
   a **self-contained `dist-cuda/`** — the `-cuda` binary plus its redistributable
   CUDA libs (cudart, cublas, cublasLt, nvrtc, nvrtc-builtins) copied from
   `CUDA_PATH` on the build box. (No GPU needed to _compile_ — it bakes
   `compute_89` PTX the user's card JITs at runtime.)
2. The **release workflow**'s "Fetch prebuilt translator sidecar" step pulls
   those into `dist/` (CPU) + `dist-cuda/` (CUDA) before `pnpm package:*`.
3. `package:<plat>:payload` ships `dist/` to `resources/translator/` ,
   **filtered to exclude `*-cuda*`** , so the base install carries only CPU.
4. `package:<plat>:archive` — `build-cuda-archive.mjs` packs the whole
   self-contained `dist-cuda/` into `cuda-<plat>.tar.zst` under
   `resources/translator/` (~+396 MB compressed on top of the LLM's CUDA). It
   needs **no CUDA toolkit on the release box** — the libs are already in
   `dist-cuda/`.

At runtime `resolveTranslatorBinary()` prefers `-cuda` when present (after a CUDA
install , or `dist-cuda/` in dev) ; if it fails to start (no driver) the service
retries on the CPU binary. macOS has no CUDA archive — always CPU.

The YAML workflows can't be exercised from a dev box — verify the
`Jimver/cuda-toolkit` action version + the minio paths on the first CI run.

## Model files

Downloaded on demand by `TranslationService` (not part of the first-launch
manifest — translation is optional) into
`<models>/translator/madlad400-3b-mt-ct2-int8/`:

| file                   | size    | source                                      |
| ---------------------- | ------- | ------------------------------------------- |
| model.bin              | 2.75 GB | santhosh/madlad400-3b-ct2 (int8 conversion) |
| sentencepiece.model    | 4.2 MB  | ″                                           |
| shared_vocabulary.json | 5.2 MB  | ″                                           |
| config.json            | 190 B   | ″                                           |

SHA256s pinned in `src/main/services/translation/manifest.ts`. TODO: mirror
the four files into the LokLM HF org (like the tier bundles) and repoint the
URLs — we should not depend on a third-party personal repo staying up.

## Runtime footprint

int8 3B ≈ 3.2 GB RAM while loaded (RAM , not VRAM — pure CPU). The service
loads lazily on first translate and stays resident; `dispose()` runs on app
quit. Sentence-level model: `TranslationService` segments input with
`Intl.Segmenter` and reassembles , see `segment.ts`.
