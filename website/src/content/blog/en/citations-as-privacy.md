---
title: 'Source citations as a privacy property, not just a UX feature'
description: 'Why answers with source citations reveal less about the model than plain model answers — privacy and verifiability are two sides of the same property.'
lang: 'en'
translationKey: 'citations-as-privacy'
pubDate: 2026-05-28
tags: ['local-ai', 'architecture', 'privacy']
---

When a product demo shows source citations, it frames them as a convenience. _"See for yourself — page 47."_ Polished, checkable, pleasant to use. None of that is false. What the framing leaves out is that a citation is simultaneously a **privacy property**. Put bluntly: an answer that carries source citations exposes less of the model's interior than an answer that carries none. The claim sounds odd at first and obvious once unpacked.

Unpacking it is the job of this article.

## What a "plain model answer" is

A language model carries the imprint of enormous training corpora. Ask it something without pointing it at particular sources, and the reply is assembled from a blend of ingredients: pretraining text, fine-tuning material, and whatever statistical generalisation happens inside the network. Sometimes the result is right. Sometimes it is invented — the field calls this hallucination[^1]. Looking at the reply alone, you usually cannot separate the two.

Call this blend the _"model-knows-things"_ surface: everything the model is capable of asserting without being anchored to any concrete document. That surface is vast — models in the 7–70 billion parameter class have digested training data measured in tens of terabytes.

## How a source citation shrinks the surface

Retrieval-augmented generation assembles its answers along a different path. First, the system queries an index and pulls out the text passages that best match the question. Those passages travel into the model's context window, and the model is instructed to build its reply **from that context** rather than from what it absorbed during training.

Now suppose the index holds nothing but the user's own material — case files, draft papers, business correspondence. The model's job narrows dramatically: _"Answer using these passages from these documents."_ Instead of asserting from _"everything training taught me,"_ it asserts from _"whatever these thirty paragraphs contain."_

A citation is what makes that narrowing visible. The moment a reply closes with _"page 17, paragraph 3,"_ the user holds a concrete handle: open the passage, compare, and judge whether the answer stayed inside the source or drifted past it.

## Privacy and verifiability turn out to be the same property

This is where the argument comes together. Ask: what privacy risk does an uncited answer actually carry?

Two risks, in fact:

1. **Leakage from the training corpus.** Content the model saw during training can surface in its output — word for word or in paraphrase. Since training corpora include web pages, forum posts, and sometimes scraped documents, an answer may carry material that has nothing to do with the question asked. The _training data extraction_ literature demonstrates that this is more than a theoretical worry[^2].
2. **Cross-contamination within a conversation.** Over several turns, a model can weave together fragments of earlier inputs. Something typed into question 1 may echo, deliberately or accidentally, in answer 3.

Both risks contract once the model is pinned to a bounded context and each passage it used is flagged in the output. To be precise about the mechanics: the tight context is what reduces the risk, not the citations themselves. What the citations add is **checkability** — without them, a user has no way of knowing whether the model really confined itself to the context it was given.

At that point, two seemingly separate questions merge:

- **Verifiability:** can I look up what the model just told me?
- **Privacy bounding:** do I have evidence the model stayed inside my documents and did not pull from elsewhere?

One technical property answers both.

## What citations do not deliver

Three limits worth stating plainly, so the argument stays honest:

- **A citation is not a faithfulness guarantee.** A model can point at a genuine source while asserting something the source never says. The literature calls this _citation hallucination_, and measurements show it happens at meaningful rates[^3]. Citations lower the risk without removing it.
- **Citations by themselves do not make a system private.** A cloud RAG service with flawless citations still ships every query to a remote server. Whether data leaves the device is a separate axis from whether answers carry references.
- **A citation is only as trustworthy as the index behind it.** If the index has gaps, a well-behaved system can say _"the available sources contain nothing on this"_ — which is genuinely useful information. A badly designed one instead lets the model quietly fall back on training knowledge. How a tool handles _"not found"_ is a design choice, and it reshapes the privacy picture.

## What the property looks like in a local architecture

An on-device RAG system such as LokLM performs three steps before any answer appears:

1. **Indexing.** Documents get sliced into chunks, and every chunk receives an embedding. The resulting index sits on disk as a local database.
2. **Retrieving.** The question is embedded too, and the closest chunks are pulled from the index — typically through a combination of dense vector similarity and lexical matching (BM25). The [architecture article](/en/architecture) walks through this hybrid retrieval in detail.
3. **Generating.** The prompt handed to the model contains the question together with the retrieved chunks, plus an instruction: stay grounded in these chunks, and label each one you draw on.

The privacy property becomes _observable_ only in step 3. Strip out the citations, and even a fully local system leaves the user unable to distinguish _"this came from my document"_ from _"the model invented this"_ — locality settles where the data lives, not where a claim came from.

## A practical consequence

Treating citations as mere UX means losing an entire evaluation dimension. When picking an AI tool for confidential material, asking _"does every statement come with a checkable source?"_ is not just about usability. The same question is:

- a privacy question (how firmly is each claim tethered to what I put in?)
- a liability question (who answers for a claim that no cited source contains?)
- an audit question (can the origin of an answer be reconstructed three months later?)

One technical property, three questions settled.

## Further in the cluster

This piece bridges the [privacy pillar](/en/local-ai) and the [architecture pillar](/en/architecture). The series opened with three legal/conceptual articles — the [definition of "private"](/en/blog/what-private-actually-means), the [EU AI Act](/en/blog/on-device-ai-under-the-eu-ai-act), and [GDPR and the LLM](/en/blog/gdpr-and-llm-data-export). This one sits on the technical/conceptual side.

Next up in the series: a [taxonomy of local AI](/en/blog/taxonomy-of-local-ai) — inference, retrieval, training, and which property attaches to which stage.

To try LokLM: [download](/en/#download), no account.

---

[^1]: Survey on hallucination in language models: Huang et al., "A Survey on Hallucination in Large Language Models". https://arxiv.org/abs/2311.05232

[^2]: Carlini et al., "Extracting Training Data from Large Language Models". USENIX Security 2021. https://arxiv.org/abs/2012.07805

[^3]: Liu et al., "Evaluating Verifiability in Generative Search Engines". EMNLP 2023. https://arxiv.org/abs/2304.09848
