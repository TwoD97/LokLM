---
title: 'A taxonomy of "local AI": inference, retrieval, training'
description: 'What can be "local" about an AI — three pipeline stages, three times the question "where does this actually run?". A reference piece for the rest of the series.'
lang: 'en'
translationKey: 'local-ai-taxonomy'
pubDate: 2026-05-28
updatedDate: 2026-10-07
tags: ['local-ai', 'architecture', 'privacy']
---

Conversations about AI tools tend to treat _"local"_ as if it named one property. It does not. A modern AI application decomposes into three distinct stages, and each stage independently answers the question "does this run on my machine or somewhere else?" Skip that decomposition, and you find yourself weighing products against each other that actually differ along different axes — while both wear the same label.

This is the reference article the rest of the series points back to: a compact definition of the three stages, followed by the combinations that show up in the wild.

## The three stages

Applying AI to one's own documents — retrieval-augmented generation, RAG[^1] — involves three separable steps:

### 1. Training

First, the language model itself is produced by training on massive text corpora. Nothing in the pipeline consumes more compute or more data. It happens once per model version, inside the data centres of the model vendor (Meta, Mistral, Microsoft, Alibaba, etc.). For an end user, this stage is essentially never local — open-weight models, too, are trained centrally and then published as downloadable files.

The exception is fine-tuning: adapting an existing model to one's own texts can happen on local hardware (LoRA, QLoRA[^2]). Training a model from zero, by contrast, sits far outside any end user's budget.

### 2. Retrieval and indexing

Before AI can answer questions about a user's documents, those documents need to live in a searchable index. The texts are cut into chunks; an embedding model turns each chunk into a numerical vector; the vectors go into a database. At query time, the question itself is embedded, and the index returns the chunks that sit closest to it.

Check embedding computation and index storage separately. A tool can send text to a remote embedding provider and store the resulting vectors locally. Conversely, locally generated vectors can be uploaded to a remote store. The location of the index alone does not tell you where its contents were processed.

### 3. Inference

Finally, the part most people picture when they say "the AI": the model takes question plus context and produces an answer. Again, both locations are possible. On-device inference typically runs through tools such as `llama.cpp`, `ollama`, or `vLLM`; remote inference means an API call to OpenAI, Anthropic, Google, or a self-hosted endpoint.

## The combinations in practice

Two locations per stage, three stages — eight combinations on paper. In practice, five constellations recur, of which A and B share an identical locality profile and diverge only architecturally:

| #   | Training              | Retrieval/Index | Inference | Type                                                                                  |
| --- | --------------------- | --------------- | --------- | ------------------------------------------------------------------------------------- |
| A   | remote                | remote          | remote    | Classic cloud LLM (web chat tools) — the most common constellation                    |
| B   | remote                | remote          | remote    | ↳ Variant of A: cloud RAG with third-party vector DB — identical from the user's view |
| C   | remote                | **local**       | remote    | Local index with remote answer generation; selected passages leave the device         |
| D   | remote                | **local**       | **local** | On-device RAG with a downloaded model — e.g., LokLM's bundled model path              |
| E   | **local** (fine-tune) | **local**       | **local** | Specialised local system — mostly research/enterprise                                 |

In constellation C, local storage can keep the full collection on the device while selected passages and the question go to a remote model. That is a narrower transfer than uploading the entire collection, but the selected content may still be sensitive. _"Local"_ in one stage does not make the whole pipeline local.

## Why the distinction has privacy consequences

Each of the three stages answers a different instance of the question **"where does this user's data show up?"**

- **Training**: downloading a pretrained model does not itself send your documents into its training process. For hosted services, inspect the policy for the specific product and account; whether inputs are used for training is a separate question from whether they are transmitted or retained.
- **Retrieval/index**: indices can hold vectors, text passages and metadata. Check which of these are stored remotely, rather than assuming that every index contains an entire original document or that vectors are harmless.
- **Inference**: this is where each individual query gets processed. Remote inference means **every single question** travels to an external server — carrying along whatever chunks the (possibly local) retrieval selected.

Assess the destinations and roles involved at each stage. The [GDPR and cloud LLM article](/en/blog/gdpr-and-llm-data-export) explains why remote processing, processor status and third-country transfers require separate checks.

## Where LokLM sits on the axes

LokLM's bundled model path occupies constellation D: models are trained externally and downloaded, then document processing runs on-device with model inference through `llama.cpp`. Workspace records use SQLite, while the vector index has a separate store. The [privacy checklist](/en/blog/what-private-actually-means) covers encryption, plaintext working copies and unchanged original files.

Optional Ollama providers can change the location of chat, embedding or reranking computation. A server on another machine receives the inputs for the selected functions; current development code requires explicit approval of that destination. A local interface therefore does not establish the processing location by itself.

These details describe the development source checked on **7 October 2026**. Check your installed release and configuration; they are not a claim that every current change is present in 0.7.0.

Local fine-tuning is not part of LokLM. Users who want a model specialised on their own texts reach for dedicated tools (Unsloth, axolotl, transformers-trainer) — that is constellation E, and deliberately outside LokLM's scope.

## What this taxonomy does not settle

A taxonomy sorts; it does not determine **which configuration fits your work**. Compare the specific service or model, available hardware, data destinations, costs and answer quality. Neither “cloud” nor “local” establishes those properties by itself.

Keeping document processing on-device avoids sending those inputs to a model server elsewhere. It still leaves questions about access to the device, backups, retention and appropriate use. Locality does not certify compliance or correct answers.

## Further in the cluster

Related concepts: the [definition of "private"](/en/blog/what-private-actually-means), the [EU AI Act](/en/blog/on-device-ai-under-the-eu-ai-act), [GDPR and the LLM](/en/blog/gdpr-and-llm-data-export), and [understanding citations](/en/blog/citations-as-privacy).

For practical checks, use the [PDF source-checking workflow](/en/blog/pdf-ai-source-checking) and [small-GPU guide](/en/blog/local-ai-4gb-vram). The [research use case](/en/use-cases/research) shows another way to organise individual document work.

Pillar pages: [local AI](/en/local-ai) and [architecture](/en/architecture). To try LokLM: [download](/en#download).

---

[^1]: Lewis et al., "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks". NeurIPS 2020. The originating RAG paper that first describes the pipeline separation used here. https://arxiv.org/abs/2005.11401

[^2]: Hu et al., "LoRA: Low-Rank Adaptation of Large Language Models". ICLR 2022. A standard technique for resource-efficient fine-tuning, also possible locally. https://arxiv.org/abs/2106.09685
