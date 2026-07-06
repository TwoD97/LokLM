---
title: 'A taxonomy of "local AI": inference, retrieval, training'
description: 'What can be "local" about an AI — three pipeline stages, three times the question "where does this actually run?". A reference piece for the rest of the series.'
lang: 'en'
translationKey: 'local-ai-taxonomy'
pubDate: 2026-05-28
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

Nothing forces this stage to be local — and nothing forces it to be remote. Where it runs is an architectural choice made by the tool vendor, and that choice determines where the embeddings of the user's documents end up living.

### 3. Inference

Finally, the part most people picture when they say "the AI": the model takes question plus context and produces an answer. Again, both locations are possible. On-device inference typically runs through tools such as `llama.cpp`, `ollama`, or `vLLM`; remote inference means an API call to OpenAI, Anthropic, Google, or a self-hosted endpoint.

## The combinations in practice

Two locations per stage, three stages — eight combinations on paper. In practice, five constellations recur, of which A and B share an identical locality profile and diverge only architecturally:

| #   | Training              | Retrieval/Index | Inference | Type                                                                                                      |
| --- | --------------------- | --------------- | --------- | --------------------------------------------------------------------------------------------------------- |
| A   | remote                | remote          | remote    | Classic cloud LLM (web chat tools) — the most common constellation                                        |
| B   | remote                | remote          | remote    | ↳ Variant of A: cloud RAG with third-party vector DB — identical from the user's view                     |
| C   | remote                | **local**       | remote    | "Hybrid": local index, cloud inference — uncommon, because the data still leaves the device for inference |
| D   | remote                | **local**       | **local** | On-device RAG with open-weight model — e.g., LokLM                                                        |
| E   | **local** (fine-tune) | **local**       | **local** | Specialised local system — mostly research/enterprise                                                     |

Constellation C repays a closer look: keeping the index on-device buys nothing for privacy if the query — bundled with the retrieved chunks — is then shipped to a cloud API for inference. The data leaves the device anyway. _"Local"_ in one pipeline stage does not add up to _"local"_ overall.

## Why the distinction has privacy consequences

Each of the three stages answers a different instance of the question **"where does this user's data show up?"**

- **Training**: the data at stake here is the training corpus, not the end user's material. So long as none of the user's data flows into training, the locality of this stage matters little for their privacy. It starts to matter when a vendor folds user inputs into future training runs — an arrangement many cloud vendors' terms of service explicitly permit (frequently on an opt-out basis).
- **Retrieval/index**: this stage physically holds the user's data — the embeddings and the original chunks. A cloud-hosted index means cloud-hosted documents, full stop, even if no "real" inference ever runs there.
- **Inference**: this is where each individual query gets processed. Remote inference means **every single question** travels to an external server — carrying along whatever chunks the (possibly local) retrieval selected.

The [GDPR obligations](/en/blog/gdpr-and-llm-data-export) examined earlier in the series attach differently at each of the three points. Third-country transfer becomes an issue at stage 2 or 3, precisely when data crosses into a third country; the processor question likewise has to be posed stage by stage.

## Where LokLM sits on the axes

On this map, LokLM occupies constellation D: the model is trained externally and downloaded; retrieval and inference both run on-device. The index is a SQLite file inside the application data directory, inference goes through `llama.cpp`, and no server anywhere receives a user query.

Local fine-tuning is not part of LokLM. Users who want a model specialised on their own texts reach for dedicated tools (Unsloth, axolotl, transformers-trainer) — that is constellation E, and deliberately outside LokLM's scope.

## What this taxonomy does not settle

A taxonomy sorts; it does not judge. Nothing above says **which constellation fits which purpose**. All-cloud constellation A has genuine strengths: the most capable models, zero setup, always up to date. For non-sensitive work — blog drafts, coding assistance, everyday questions — A costs the user little.

The case for constellation D begins where the content turns sensitive: client files, unpublished research, business records, medical notes. At that point, keeping retrieval and inference on-device measurably changes which legal obligations apply — the earlier articles in the series lay this out.

## Further in the cluster

With this taxonomy, the conceptual arc of the privacy pillar is complete. It builds on: the [definition of "private"](/en/blog/what-private-actually-means), the [EU AI Act](/en/blog/on-device-ai-under-the-eu-ai-act), [GDPR and the LLM](/en/blog/gdpr-and-llm-data-export), and [citations as a privacy property](/en/blog/citations-as-privacy).

Upcoming articles turn to concrete workflows — what local AI looks like day to day in a [law firm](/en/use-cases/lawyer) or a [research group](/en/use-cases/research).

Pillar pages: [local AI](/en/local-ai) and [architecture](/en/architecture). To try LokLM: [download](/en/#download).

---

[^1]: Lewis et al., "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks". NeurIPS 2020. The originating RAG paper that first describes the pipeline separation used here. https://arxiv.org/abs/2005.11401

[^2]: Hu et al., "LoRA: Low-Rank Adaptation of Large Language Models". ICLR 2022. A standard technique for resource-efficient fine-tuning, also possible locally. https://arxiv.org/abs/2106.09685
