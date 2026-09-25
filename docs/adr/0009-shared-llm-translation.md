# ADR-0009: Translation through the selected LLM

**Status:** accepted

## Context

Chat already loads a multilingual language model. The separate CTranslate2
translation executable added another model, process, native build pipeline and
roughly 3 GB of downloads. Development could start without the required models,
and the command-line download catalogue disagreed with the installer tiers.

## Decision

Translation uses the selected chat provider through `generateRaw`, including
the existing Ollama connector and its bundled fallback. Bundled inference stays
local. An explicitly selected Ollama endpoint receives translation text just as
it receives chat text.

Translation has its own system instructions, deterministic sampling and disabled
reasoning on the bundled model. Nearby sentences remain together in bounded
UTF-8 chunks. Small generations use the existing utility context when memory
allows; small GPUs share the main context and restore chat history afterward.
Requests share the worker queue, report chunk progress and can
be canceled; canceled documents never return a partial result as complete.
An output-token limit is reported as an error instead of a completed translation.
Concurrent first-use requests share device probing and loading. GPU layer
allocation reserves the planned context before allocating model weights, and
failed context creation releases those weights before a retry.

The translator sidecar, build workflow and installer resources are removed.
Historical translation benchmarks remain evidence of the old configurations;
they do not establish that the new path is better for every language. Existing
installed sidecar files are left untouched and are no longer used by this code.

Development and runtime model-download commands use the installer manifest.
Plain `pnpm dev` provisions Standard (Lite below 16 GiB RAM); flags override the
tier. Verified files from an existing installation are reused. Downloads stream
with backpressure, resume partial transfers, verify size/checksum and publish
only complete files. Evaluation model pools remain separate.

## Consequences

There is one less model to download and keep resident, and no separate native
translation toolchain. The balanced default remains Qwen3.5 4B, with the Standard
embedding model. Translation now competes with chat for the same inference
queue. Language coverage, faithfulness and latency depend on the selected LLM;
removing the specialized model is not a universal quality or speed claim.

Long texts are translated in bounded chunks, so context across chunk boundaries
is limited. Tests cover Unicode/whitespace reassembly, request cancellation,
provider options, provisioning integrity and resume behavior. Real-model smoke
checks supplement these deterministic tests; they are not a language benchmark.
