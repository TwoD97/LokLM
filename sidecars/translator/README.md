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
pwsh scripts/build-translator-sidecar.ps1
```

Stages `dist/loklm-translator(.exe)` , which electron-builder ships to
`resources/translator/` (see `extraResources` in package.json). `dist/` is
committed empty (.gitkeep) so packaging without the sidecar still works — the
app then reports the translator as unavailable instead of failing the build.

Cold build fetches CTranslate2 (pinned tag in CMakeLists.txt) + SentencePiece
and takes 10-25 min. Versions are pinned in CMakeLists.txt; the CT2 API used
here is the v4.x `Translator(ModelLoader, ReplicaPoolConfig)` shape.

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
