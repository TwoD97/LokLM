---
title: 'A taxonomy of "local AI": inference, retrieval, training'
description: 'What can be "local" about an AI — three pipeline stages, three times the question "where does this actually run?". A reference piece for the rest of the series.'
lang: 'en'
translationKey: 'local-ai-taxonomy'
pubDate: 2026-05-28
tags: ['local-ai', 'architecture', 'privacy']
---

> **Note:** First draft — will be edited before publication.

In the discussion of AI tools, the word _"local"_ is often used as though it meant a single thing. A modern AI application in fact spans three separable stages, each of which can run locally or remotely. Anyone who does not pull the three apart ends up comparing products that differ on different axes — under a single label.

This article is the reference that other pieces in the series link back to. It defines the three stages briefly and shows which combinations appear in practice.

## The three stages

An AI application applied to a user's own documents (retrieval-augmented generation, RAG[^1]) runs through three separable steps:

### 1. Training

The language model is trained on large text corpora. This is the most compute- and data-intensive stage. It happens once per model version, at the model vendor (Meta, Mistral, Microsoft, Alibaba, etc.), in their data centres. For end users, training is in almost all cases **not local** — even open-weight models are trained centrally and then released as a file.

Exceptions: fine-tuning can take place locally (LoRA, QLoRA[^2]), when a user specialises an existing model on their own texts. Full training from scratch is not economically realistic for end users.

### 2. Retrieval and indexing

When AI is to be applied to a user's own documents, those documents must sit in a searchable index. Texts are split into chunks; each chunk is converted by an embedding model into a numerical vector; those vectors land in a database. On a query, the question itself becomes a vector; the system searches the index for the most similar chunks.

This stage **can** be local. It can also be in the cloud. The choice is an architectural decision by the tool vendor and directly affects where the user's document embeddings live.

### 3. Inference

The step most people think of as "the AI": the model produces an answer from question + context. This stage too **can** be local or remote. Local inference is typically implemented with tools like `llama.cpp`, `ollama`, or `vLLM`; remote inference goes through an API to OpenAI, Anthropic, Google, or self-hosted endpoints.

## The combinations in practice

Three stages, two possible locations (local/remote) per stage. Theoretically that gives eight combinations; in practice five are common:

| #   | Training              | Retrieval/Index | Inference | Type                                                                                                      |
| --- | --------------------- | --------------- | --------- | --------------------------------------------------------------------------------------------------------- |
| A   | remote                | remote          | remote    | Classic cloud LLM (web chat tools) — the most common constellation                                        |
| B   | remote                | remote          | remote    | Cloud RAG with third-party vector DB — same as A from the user's view                                     |
| C   | remote                | **local**       | remote    | "Hybrid": local index, cloud inference — uncommon, because the data still leaves the device for inference |
| D   | remote                | **local**       | **local** | On-device RAG with open-weight model — e.g., LokLM                                                        |
| E   | **local** (fine-tune) | **local**       | **local** | Specialised local system — mostly research/enterprise                                                     |

Constellation C is instructive: a local index produces no privacy benefit when the query plus retrieved chunks goes to a cloud API for inference. The data still leaves the device. _"Local"_ in one part of the pipeline is not _"local"_ as a whole.

## Why the distinction has privacy consequences

Each stage decides **where this user's data appears**.

- **Training**: this is not about the end user's data but about the training data. As long as the user does not contribute data to training, training-locality is secondary to their privacy. It becomes relevant when a vendor incorporates user inputs into future training runs — a constellation regulated in many cloud vendors' terms of service (often by opt-out).
- **Retrieval/index**: this is where the user's own data sits, in the form of embeddings and original chunks. If the index lives in the cloud, the user's documents live in the cloud — even when no "actual" inference happens there.
- **Inference**: this is where individual queries are processed. If inference is remote, **every query** goes to an external server — including the chunks the local retrieval may have selected.

The [GDPR obligations](/en/blog/gdpr-and-llm-data-export) discussed in an earlier article apply differently at each of these three points. Third-country transfer arises in stage 2 or 3, the moment data reaches a third country. Processorship arises per stage as well.

## Where LokLM sits on the axes

LokLM lives in constellation D: training external (the model is downloaded), retrieval and inference local. The index is a SQLite file in the application data directory; inference runs through `llama.cpp`. There is no server receiving user queries.

LokLM does not offer a local fine-tuning option. Users who want to specialise a model on their own texts use separate tools (Unsloth, axolotl, transformers-trainer) — that is constellation E and lies outside LokLM's scope.

## What this taxonomy does not settle

A taxonomy is a sorting, not a verdict. It says nothing about **which constellation is right for which purpose**. Constellation A (all cloud) has its own merits: stronger models, no setup overhead, always current. For users working with non-sensitive content — blog drafts, coding help, general queries — there is little to lose in A.

Constellation D becomes interesting once the content is sensitive: client files, research drafts, business records, medical notes. There, locality of retrieval and inference measurably shifts the legal obligations — see the earlier articles in the series.

## Further in the cluster

This taxonomy closes the conceptual round of the privacy pillar. Earlier: [definition of "private"](/en/blog/what-private-actually-means), [EU AI Act](/en/blog/on-device-ai-under-the-eu-ai-act), [GDPR and the LLM](/en/blog/gdpr-and-llm-data-export), [citations as a privacy property](/en/blog/citations-as-privacy).

The next articles in the series will show concrete workflows — how a [law firm](/en/use-cases/lawyer) or a [research group](/en/use-cases/research) uses local AI in practice.

Pillar pages: [local AI](/en/local-ai) and [architecture](/en/architecture). To try LokLM: [download](/en/#download).

---

[^1]: Lewis et al., "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks". NeurIPS 2020. The originating RAG paper that first describes the pipeline separation used here. https://arxiv.org/abs/2005.11401

[^2]: Hu et al., "LoRA: Low-Rank Adaptation of Large Language Models". ICLR 2022. A standard technique for resource-efficient fine-tuning, also possible locally. https://arxiv.org/abs/2106.09685
