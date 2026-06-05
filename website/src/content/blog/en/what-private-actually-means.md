---
title: 'What "private" actually means for an AI assistant'
description: 'A checklist of five testable properties — how to measure whether an AI tool is genuinely private. With GDPR and EU AI Act references.'
lang: 'en'
translationKey: 'private-definition'
pubDate: 2026-05-28
tags: ['local-ai', 'gdpr', 'privacy']
---

> **Note:** First draft — will be edited before publication.

The word "private" now appears on almost every product page that markets artificial intelligence. It means something different every time. From a cloud provider, "private" often means "we promise not to use your input for training." From a browser plug-in, it means "encrypted in transit." From an on-device system, it means "the text never leaves the device."

These three statements look similar. They describe fundamentally different things.

Anyone introducing AI tools into a law firm, a research group, or a consultancy needs more precise language. Otherwise you risk adopting a system that does not meet your confidentiality obligations — not from any bad intent on the vendor's side, but because "private" meant two different things on either side of the conversation.

This article proposes a definition. Five properties, each testable on its own. After running a piece of software through this list, you know what you have.

## Why the question is not legally trivial

The General Data Protection Regulation contains no word "private." It contains **personal data** (Art. 4(1) GDPR[^1]) and **processing** (Art. 4(2) GDPR). The moment an AI system processes personal content — a client letter, an email thread, a draft contract — the obligations from Arts. 5, 24, and 32 GDPR apply: legal basis, technical and organizational measures, records of processing.

A second layer comes from the EU AI Act, in force since August 2024, with its obligations applying on a staggered schedule[^2]. For most end-user tools, the transparency obligations from Art. 50 matter: users must be able to recognize that they are interacting with an AI system and which content was AI-generated.

What follows from both texts: using "private" as a marketing claim says nothing about whether the processing is **lawful**. "Private" is not a legal category. It is a marketing word that can describe a technical situation accurately — or obscure one.

## The five properties

The five points below describe what must combine in an AI assistant for "private" to become a testable claim rather than an atmosphere.

### 1. On-device inference

**The model that generates the answer runs on the end device.** No request travels to an external server, no API call, no reverse tunnel.

How to test: open a network monitor, ask a question, watch outbound traffic. A genuinely local system produces no outbound traffic during inference, save for a possible one-shot update check on startup.

This is not a subtlety. "Encrypted transmission to the vendor" and "no transmission to the vendor" describe different legal situations. The first is processing by a processor in the sense of Art. 28 GDPR — requiring a data processing agreement, a record entry, and possibly a third-country transfer mechanism[^3]. The second is no transmission to a third party at all.

### 2. Local index, local storage

Anyone applying AI to their own documents — retrieval-augmented generation, RAG for short — generates **vector embeddings**: numerical representations of the texts that the system uses to find similar passages. These embeddings are derivatives of the content. They are not harmless.

**Where do the embeddings live?** Software that promises "local AI" but uploads embeddings to a cloud server has moved the confidentiality problem, not solved it. Anyone holding embeddings can reconstruct many properties of the source text — research on embedding inversion shows this clearly[^4].

How to test: after indexing a document, check the application's data directory for a file-backed database (a SQLite file, a vector store). If one appears: is it local? The second question matters as much as the first.

### 3. No telemetry

Telemetry is the default assumption of modern software: small data packets about usage, errors, and device properties going automatically to the vendor. Common, often anonymized, technically useful for bug fixes.

For a confidential system, that is a problem. Anonymization in telemetry data is weaker than commonly assumed — device fingerprints and usage patterns alone are often enough for re-identification. Furthermore, the GDPR does not distinguish "content data" from "metadata": both can be personal data.

How to test: network monitor again. Software claiming to be fully local should produce no outbound traffic across long sessions. Optionally: check the settings for whether telemetry is toggleable, and what its default state is.

### 4. Auditable code

This is the structural property. The first three points are behavioural observations. They can change with the next update.

When source code is publicly available — open source — an interested third party (or a contracted security firm) can verify the behavioural claims against the code. With proprietary software, the marketing material is all that remains.

Auditability is not the same as "audited." Open source code does not guarantee security; it makes verification possible. That is the only form in which a confidentiality claim stays stable over time: by being checkable, not by being promised.

How to test: look for a repository link on the vendor's website. With open-source projects, usually GitHub or GitLab. No link findable means probably no open code.

### 5. No background synchronisation

A final point that is often overlooked. Some "local" software synchronises settings, conversation histories, or templates with a cloud account belonging to the same vendor — a convenience feature. The moment that happens, the system is no longer local in the sense the first point describes.

How to test: scan the settings for account, sync, or cloud options. If present: enabled by default, or disabled by default? Software that ships with nothing syncing and offers synchronisation as opt-in behaves differently from software that ships with sync opt-out.

## Why the list is neither longer nor shorter

These five points cover the paths by which data leaves an end device or becomes reconstructable. Inference (1), index persistence (2), telemetry (3), and sync (5) are the four possible egress paths. Auditability (4) is the structural condition that lets the other four claims remain checkable over time.

Items that appear in other definitions and are deliberately absent here:

- **"Encrypted"**: encryption says nothing about who holds the key. It is a necessary but not sufficient criterion.
- **"GDPR-compliant"**: software can satisfy five of the five points and still be operated in a non-compliant way (e.g., without a record of processing, without a legal basis). Compliance is a property of the deployment, not of the tool alone.
- **"Privacy-first"**: a self-description, not a test.

## How to apply the list

Six steps to evaluate a specific AI tool:

1. Open the vendor's site. Does "local" or "on-device" appear on the landing page? If so, is it specified concretely (which model runs where)?
2. Network monitor during a sample query: does traffic leave the LAN? (Update checks excepted.)
3. Inspect the application data directory after indexing: does a local file database appear?
4. Review settings: is there toggleable telemetry? What is its default?
5. Repository link on the website — and how recent is the latest release?
6. Cloud sync options: opt-in, or opt-out?

Three of the six (1, 2, 6) take ten minutes. The other three (3, 4, 5) take a bit of patience but yield the full picture.

## How LokLM relates to the list

LokLM is an [on-device application](/en/local-ai) for Windows and macOS. Inference runs through `llama.cpp` locally, the vector index is a SQLite file in the application data directory, there is no telemetry and no account. The source code is on GitHub[^5].

Point 5 — background sync — does not exist in LokLM: there is no cloud component to sync with.

That is the honest position. Other tools satisfy subsets of this list — that is not a judgement, only an observation. The checklist's purpose is that anyone can decide for themselves which subset is sufficient for their use case.

## Further in the cluster

For readers who want to follow the legal thread: the next article in the series covers [GDPR obligations when feeding documents into cloud LLMs](/en/blog/gdpr-and-llm-data-export) (Arts. 44 ff. — third-country transfer).

For readers who want the technical architecture these properties rest on: the [full architecture](/en/architecture) describes the hybrid retrieval, the embedding model for German text, and the storage strategy.

For readers who want to try LokLM: the [download](/en/#download) is available without an account or an email address.

---

[^1]: Regulation (EU) 2016/679 — General Data Protection Regulation. Consolidated text at EUR-Lex: https://eur-lex.europa.eu/eli/reg/2016/679/oj

[^2]: Regulation (EU) 2024/1689 — Regulation on Artificial Intelligence (AI Act). https://eur-lex.europa.eu/eli/reg/2024/1689/oj

[^3]: Overview of Standard Contractual Clauses (SCC) and third-country transfer rules at the European Data Protection Board: https://www.edpb.europa.eu/

[^4]: For example, on embedding inversion: Morris et al., "Text Embeddings Reveal (Almost) As Much As Text", arXiv:2310.06816. https://arxiv.org/abs/2310.06816

[^5]: LokLM source code repository: https://github.com/TwoD97/LokLM
