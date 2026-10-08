---
title: 'Local AI with 4 GB VRAM: model fit and document workflows'
description: 'Understand GPU memory, model loading and indexing on a small GPU. Check LokLM settings and evaluate speed and source quality with your own documents.'
lang: 'en'
translationKey: 'local-ai-small-gpu-guide'
pubDate: 2026-10-07
tags: ['local-ai', 'hardware', 'pdf']
---

“My GPU has 4 GB” is not enough to predict whether a document assistant will feel responsive. The model, available memory, question length and work happening alongside the chat all matter. This guide explains what to check before importing a large library or assuming that a larger model will improve the result.

**LokLM version scope:** the resource policy described here reflects the [development source](https://github.com/TwoD97/LokLM) checked on 7 October 2026. It is not a promise that release 0.7.0 contains every current scheduling or settings change. Check the version you installed and its release notes.

## Four different sizes matter

| Size                   | What it means for your work                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| Model download on disk | Storage required for the model file; it is not the full runtime memory budget.                               |
| System RAM             | Memory shared by the operating system, the app, document processing and any model work placed there.         |
| GPU memory             | Space available for model weights, inference state and other GPU allocations. Other applications use it too. |
| Context window         | The token budget available for instructions, conversation, selected source passages and generation.          |

Increasing context consumes additional memory. Ollama's [context-length documentation](https://docs.ollama.com/context-length) explains that relationship; its own defaults should not be treated as LokLM defaults.

Quantisation reduces the storage and memory needed for model weights, with tradeoffs that depend on the model and method. The [llama.cpp project](https://github.com/ggml-org/llama.cpp) supports quantised models and combined CPU/GPU inference. A model file smaller than the GPU's advertised capacity can still fail to fit once runtime allocations are included.

Integrated GPUs may share system memory. Their reported capacity should not be compared directly with dedicated VRAM as if it were a separate, equally fast memory pool.

## What LokLM does on a constrained GPU

For the bundled models, LokLM requires a supported integrated or dedicated GPU and a working driver. **A CPU-only configuration is not supported.** Some chat model layers can still run on the CPU while others run on the GPU; that is different from an entirely CPU-based model path.

The current development policy gives GPU access to the active task. On constrained hardware, preparing document embeddings can release the chat model, run the embedding task and later load chat again. This avoids assuming that every model can stay in GPU memory at once, but the handoff costs time.

The reranker is an additional model that reorders retrieved passages. It does not generate the final answer. In **Auto**, the current policy skips the bundled reranker on a 4 GB GPU to preserve resources. Document retrieval still operates; its result quality needs checking for your documents. Forcing **Always** can add model swaps and longer waits. More loaded models are not automatically a better workflow.

None of these policies guarantees that a particular model fits every 4 GB device. Free memory, backend support, context and model architecture remain relevant.

## A sensible first setup

1. **Check the detected GPU.** In the model/system settings, confirm the intended device is available. If it is not, check the driver and reported error before trying a larger model. CPU-only operation is not the workaround.
2. **Begin with automatic placement and a small available model.** Treat a successful load as the beginning of a test, not evidence that all tasks will fit.
3. **Leave reranking on Auto.** If your version reports that it is skipped for limited GPU memory, that describes a resource decision rather than a failed chat model.
4. **Index a small representative document set first.** Include an ordinary PDF and, if relevant to your work, a scan or table. Wait for indexing to finish before measuring a chat response.
5. **Close unnecessary GPU-heavy applications.** Compare with the same model and question so that you can tell which change helped.

If you use optional Ollama providers, check their model and server configuration separately. An approved server on another computer changes where the selected processing takes place; it should not silently become a workaround for keeping confidential work local.

## Measure the work you actually need

Use a non-sensitive sample whose answers you can verify. This worksheet records your observations; the article supplies no invented benchmark results.

| Observation      | Record                                                                           |
| ---------------- | -------------------------------------------------------------------------------- |
| Environment      | App version, model, GPU, RAM and other active GPU applications                   |
| Import           | Document count, approximate length, scans/tables and any extraction errors       |
| Indexing         | Start-to-ready time and whether progress or an error appeared                    |
| First question   | Time until the first answer text, including any model loading                    |
| Follow-up        | Time for another comparable question after the model is ready                    |
| Evidence quality | Correct values, checked citations, preserved exceptions and unresolved conflicts |

Use the same documents and question when comparing settings. Keep loading time separate from the subsequent response: a fast follow-up does not describe the first interaction after indexing.

Stop a test that repeatedly reports loading or memory errors and record the message. Try a smaller model or context through the controls your version exposes. Avoid repeatedly forcing the same failing combination.

## Keep quality in the decision

A shorter context can reduce memory pressure, but it also leaves less room for history and evidence. Narrow a question to the document or section you need, while keeping the qualifications required to answer it. Cutting away a source's exception merely to fit the budget can produce a faster wrong answer.

Use the [PDF source-checking workflow](/en/blog/pdf-ai-source-checking) to review results. LokLM can still mishandle contradictory sources even when model loading and retrieval complete successfully. Neither an enabled reranker nor a larger GPU certifies the conclusion.

If a representative task cannot complete reliably or the wait is unsuitable, that configuration does not meet your needs. The useful outcome of the test is knowing that before investing time in a large import. The [download page](/en#download) and [architecture overview](/en/architecture) provide the next checks for LokLM.
