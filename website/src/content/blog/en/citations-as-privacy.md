---
title: 'Source citations as a privacy property, not just a UX feature'
description: 'Why answers with source citations reveal less about the model than plain model answers — privacy and verifiability are two sides of the same property.'
lang: 'en'
translationKey: 'citations-as-privacy'
pubDate: 2026-05-28
tags: ['local-ai', 'architecture', 'privacy']
---

> **Note:** First draft — will be edited before publication.

Product demos usually present source citations as a convenience feature. _"Here's the source, page 47."_ Slick. Verifiable. User-friendly. That is not wrong — but it misses that citations are at the same time a **privacy property**. The thesis below is not obvious, but it is plain once stated: answers with source citations reveal less about the model than answers without.

This article works the thesis out.

## What a "plain model answer" is

A language model has been trained on large text corpora. When it answers a question without referencing specific sources, it draws from a mixture: the training corpus, any fine-tuning data, and internal statistical generalisation. The answer can be correct. It can also be made up (the phenomenon is called hallucination[^1]). From the answer alone it is often not possible to see which part is which.

This mixture is the _"model-knows-things"_ surface. It is the sum of all statements the model can make without grounding in concrete sources. It is large: a model in the 7–70 billion parameter range has seen training data in the double-digit terabyte range.

## How a source citation shrinks the surface

A retrieval-augmented answer is built differently. Before generation, the system searches an index for matching text passages. The retrieved passages are passed to the model as context. The model is supposed to ground its answer **on this context**, not on its training knowledge.

When the index contains only the user's own documents — client files, research drafts, business records —, the model faces a narrower task: _"Answer this question with reference to these passages from these documents."_ The statement surface shrinks from _"everything I know from training"_ to _"what is in these thirty paragraphs."_

Source citations are the visibility of that shrinking. When an answer ends with _"page 17, paragraph 3,"_ the user has a direct lever: they can check the passage and see whether the answer is faithful to the source or whether the model went beyond it.

## Privacy and verifiability as the same property

Here is where the thesis lands. What is the privacy risk in an answer without source citations?

Two things at once:

1. **Information leak from training.** The model could emit content that was in its training corpus — verbatim or paraphrased. When the corpus contains web pages, forum data, possibly scraped documents, an answer can accidentally include content unrelated to the user's question. Research on _training data extraction_ has shown this is technically possible[^2].
2. **Information mix from multiple inputs.** In multi-turn conversations, the model can blend content from earlier inputs. What the user put into question 1 can resurface in answer 3 — intentionally or not.

Both risks shrink when the model is forced onto a bounded context and the passages used are marked in the answer. Citations are not the mechanism that reduces the risk — the mechanism is the tight context. But the citations make the bounding **checkable**: without them, the user cannot tell whether the model truly used only the context.

Two properties then collapse into one:

- **Verifiability:** Did I look up what the model is telling me?
- **Privacy bounding:** Do I have grounds to assume the model did not reach across into other sources?

Both questions become answerable through the same technical property.

## What citations do not deliver

Three important limits, so the thesis is not over-extended:

- **Citations do not guarantee faithfulness.** A model can cite a correct source and yet state something that is not in the source as stated. This is called _citation hallucination_ and is measurably common[^3]. Citations reduce the risk; they do not eliminate it.
- **Citations alone do not make a system private.** A cloud RAG system with perfect citations still sends the request to an external server. The privacy property _"data does not leave the device"_ is orthogonal to the citation property.
- **Citations are only as good as their index.** When the index is incomplete, the system can honestly answer _"I find nothing on this in the available sources"_ — a valuable statement. It can also force the model to fall back on training knowledge anyway. How a system handles _"not found"_ is a design decision that changes the privacy picture.

## What the property looks like in a local architecture

In an on-device RAG architecture like LokLM, three steps run before an answer is produced:

1. **Indexing.** Documents are split into chunks; each chunk is assigned an embedding. The index lives locally as a database.
2. **Retrieving.** The user's question is converted to an embedding; the most similar chunks from the index are selected — usually a mix of dense (vector similarity) and lexical (BM25). This hybrid retrieval logic is detailed in the [architecture article](/en/architecture).
3. **Generating.** The model receives the question plus the selected chunks as a prompt. It is instructed to ground its answer in these chunks and to mark the source of each chunk in the answer.

Step 3 is where the privacy property becomes _visible_. Without citations, the user could not tell _"this was in my document"_ from _"the model made this up"_ — locality alone does not help with that distinction.

## A practical consequence

Anyone treating citations as a pure UX feature misses an evaluation dimension. When choosing an AI tool for confidential content, the question _"does the system deliver a verifiable source per statement?"_ is not only a UX question. It is also:

- a privacy question (How tightly is the statement bound to the input?)
- a liability question (Who is responsible for a statement that appears in no cited source?)
- an audit question (Can someone, three months later, trace where an answer came from?)

Three questions, one technical property.

## Further in the cluster

This article links the [privacy pillar](/en/local-ai) with the [architecture pillar](/en/architecture). The first three articles in the series — [definition of "private"](/en/blog/what-private-actually-means), [EU AI Act](/en/blog/on-device-ai-under-the-eu-ai-act), [GDPR and the LLM](/en/blog/gdpr-and-llm-data-export) — are legal/conceptual. This one is technical/conceptual.

The next piece in the series will sketch a [taxonomy of local AI](/en/blog/taxonomy-of-local-ai) — inference, retrieval, training, and which property applies to which.

To try LokLM: [download](/en/#download), no account.

---

[^1]: Survey on hallucination in language models: Huang et al., "A Survey on Hallucination in Large Language Models". https://arxiv.org/abs/2311.05232

[^2]: Carlini et al., "Extracting Training Data from Large Language Models". USENIX Security 2021. https://arxiv.org/abs/2012.07805

[^3]: Liu et al., "Evaluating Verifiability in Generative Search Engines". EMNLP 2023. https://arxiv.org/abs/2304.09848
