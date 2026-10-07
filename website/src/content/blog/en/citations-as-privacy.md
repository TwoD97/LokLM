---
title: 'Understanding citations: evidence and privacy'
description: 'What a source reference lets you check, why it does not prove an answer correct, and which separate questions establish where your document data goes.'
lang: 'en'
translationKey: 'citations-as-privacy'
pubDate: 2026-05-28
updatedDate: 2026-10-07
tags: ['local-ai', 'architecture', 'privacy']
---

A source citation gives you a place to inspect a claim. It does not prove that the claim follows from that passage, that every relevant document was considered, or that the document stayed on your device. Those are separate questions, requiring different evidence.

_Correction, 7 October 2026: an earlier version of this article described citations and privacy as the same property and suggested that cited answers reduce training-data leakage. Those claims were not established. This revision separates source verification from data handling._

## Three checks behind a useful citation

A source badge can look convincing before you have checked what it points to. Inspect three things:

1. **Identity:** does the reference resolve to the intended document, version and passage?
2. **Support:** does that passage justify the attached claim, including its scope, conditions and numbers?
3. **Coverage:** do the other material claims have support, and are relevant exceptions or contradictions missing?

Passing the first check does not pass the other two. A genuine page about a proposed budget does not establish that the budget was approved. A correct number from one year may be wrong for the period in the question.

Research makes a similar distinction: [ALCE](https://aclanthology.org/2023.emnlp-main.398/) evaluates answer correctness and citation quality separately and reports incomplete citation support in the systems it studied. Those benchmark results are not measurements of LokLM.

## What retrieval adds

In retrieval-augmented generation, a system finds passages and supplies them to a model alongside the question. The model is asked to answer from that evidence. This makes relevant text available without placing the entire collection in every prompt.

It also introduces several places where the result can go wrong: extraction may lose a table heading; retrieval may miss a relevant passage; the answer may misread a condition. A citation helps you inspect the result of this process. It is not a trace proving that the model used only the cited text or ignored its training knowledge and earlier conversation.

The [architecture overview](/en/architecture) explains LokLM's retrieval pipeline. Its source links help you return to evidence, but they cannot guarantee faithful reasoning. Conflicting-source interpretation remains a known limitation in the current development evaluation: an answer may confidently assign authority that the documents do not establish.

## Privacy requires a different set of checks

To establish data handling, inspect the processing configuration and storage:

| Question                                              | Evidence to examine                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| Where are document embeddings computed?               | Selected embedding provider and its destination                                 |
| Where are questions and retrieved passages processed? | Chat and reranking providers, server addresses and permissions                  |
| What remains on disk?                                 | Original files, extracted text, indices, logs, backups and their protection     |
| Does anything leave during normal use?                | Documented network functions and observed traffic across the relevant workflows |

Neither a citation nor the absence of one answers these questions. A remote service can provide accurate citations while receiving document content. A local model can invent a claim without sending a request elsewhere. Sending less source text also does not make the remaining content non-sensitive.

For LokLM, the bundled model path processes locally after model downloads. Optional Ollama providers are a separate configuration choice; a server on another machine receives content for the functions assigned to it. Current development code requires explicit approval of that remote destination. The [privacy checklist](/en/blog/what-private-actually-means) covers this distinction and the storage caveats. Check the behaviour of your installed release; development changes should not be assumed to be present in 0.7.0.

## A useful review habit

When an answer matters, open its references before copying its conclusion. Read the surrounding text and keep observations separate from your interpretation. If two documents disagree, retain both statements and identify what would establish which one applies. If a search finds nothing, record that limited result rather than concluding that a rule does not exist.

For a repeatable process and a reusable evidence-note template, follow the [PDF source-checking workflow](/en/blog/pdf-ai-source-checking). For where each part of a document assistant runs, see the [taxonomy of local AI](/en/blog/taxonomy-of-local-ai).

_Product statements were checked against the [current development source](https://github.com/TwoD97/LokLM) on 7 October 2026. This article describes inspection practices, not a security audit or a claim of error-free answers._
