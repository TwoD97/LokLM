---
title: 'What "private" actually means for an AI assistant'
description: 'Five practical checks for AI data handling: processing location, storage, telemetry, auditability and sync. With LokLM provider and storage caveats.'
lang: 'en'
translationKey: 'private-definition'
pubDate: 2026-05-28
updatedDate: 2026-10-07
tags: ['local-ai', 'gdpr', 'privacy']
---

Hardly a product page in the AI market goes without the word "private" anymore — and hardly any two of them use it to mean the same thing. A cloud provider saying "private" usually means "your inputs won't be used for training, promise." A browser plug-in means "we encrypt the connection." An on-device system means "the text never leaves your machine."

Three claims, superficially interchangeable. Underneath, three entirely different facts.

For anyone bringing AI tools into a law firm, a research group, or a consultancy, this vagueness is a real hazard. The failure mode is not vendor malice — it is a purchase in which "private" quietly meant one thing to the buyer and another to the seller, and the resulting system falls short of the buyer's confidentiality obligations.

The following five checks help make the claim more concrete. They are a starting point for inspecting a deployment, not a complete security audit.

## Why the question is not legally trivial

When an AI tool processes personal data, its lawful basis, purpose, data minimisation and appropriate safeguards still need assessment. Local execution alone does not answer those questions. The [European Data Protection Board](https://www.edpb.europa.eu/sme/learn-the-basics/data-protection-basics_en) provides an accessible introduction.

AI Act duties also depend on role and use. [Article 50 and the Commission's explanation](https://digital-strategy.ec.europa.eu/en/policies/guidelines-ai-transparency-obligations) distinguish direct-interaction notices, technical marking and disclosure for certain publications. This does not create a blanket labelling duty for every internal note. A “private” marketing claim establishes neither AI Act nor GDPR compliance.

## The five properties

Check these aspects separately. Record the selected configuration and app version so that a result is not silently carried over to a different setup.

### 1. On-device inference

**Establish where answer generation happens.** A local model can run inside the app or through an API served on the same device. An API call is not necessarily a remote call; its destination matters. Check embedding and reranking providers separately from the chat model.

Testing it: inspect the configured destinations, then observe traffic while importing, indexing and asking a question with non-sensitive sample material. Distinguish model downloads and update checks from content processing. One quiet test cannot prove that every workflow, error path or later update stays local.

Encrypted transmission and entirely local processing create different data flows. Whether an external service is a processor depends on its actual role; processing on your behalf requires an Article 28 GDPR assessment. Include backups, remote access and optional services in that review. See [GDPR and cloud LLMs](/en/blog/gdpr-and-llm-data-export).

### 2. Local index, local storage

Running AI over one's own documents — retrieval-augmented generation, RAG — produces **vector embeddings**: numerical encodings of the texts, used to locate similar passages. An embedding is a derivative of the document. It is anything but innocuous.

So: **where do the embeddings end up?** A tool may run chat locally while sending document text to an embedding service or storing vectors remotely. Do not assume that a numerical representation is harmless: research has demonstrated reconstruction of text from embeddings under studied conditions[^4]. That is a reason to protect derived data, not a claim that every embedding can always be reversed.

Testing it: identify where originals, extracted text and indices are stored and which copies are encrypted. Check temporary working files and operating-system or folder backups too. A local database does not prove that another copy was never uploaded.

### 3. No telemetry

Telemetry can report usage, crashes and device characteristics to a vendor. Its privacy implications depend on the actual contents, destinations and controls. A report containing a document path or excerpt needs different scrutiny from a simple aggregate counter. Inspect what is sent instead of assuming that the label “anonymous” settles the question.

Testing it: inspect the documented telemetry and crash-reporting policy, settings and observed destinations. Check what reports contain, whether sending is optional and what the default is. Network silence during one session is limited evidence, not proof of absence.

### 4. Auditable code

This property differs in kind from the previous three. Points 1 through 3 are observations of behaviour — and behaviour can flip with any update.

Public source code lets reviewers inspect implementation claims. For the installed application, they also need to establish which source version and dependencies the binary contains. Independent audits and deployment tests can provide evidence for both open and closed software.

Auditable does not mean audited. Open code offers an inspection opportunity; it does not establish that someone has checked the relevant behaviour or found every defect.

Testing it: hunt for a repository link on the vendor's site — for open-source projects, usually GitHub or GitLab. If no link turns up, open code probably does not exist.

### 5. No background synchronisation

Sync can send settings, chat histories or documents elsewhere even when model inference runs on the device. Check app sync and external services that back up the app's folders. Local inference and local-only storage are separate properties.

Testing it: comb the settings for anything labelled account, sync, or cloud. Where such options exist, the default matters: a tool that syncs nothing until asked (opt-in) behaves fundamentally differently from one that syncs until stopped (opt-out).

## What these checks leave open

The list is not exhaustive. Exports, clipboard use, shared computers, backups, malicious software and access to an unlocked session can expose information too. The relevant risks depend on how and where the tool is used.

Some criteria that other definitions include are left out here on purpose:

- **"Encrypted"**: encryption is silent on the decisive question — who holds the key. Necessary, never sufficient.
- **"GDPR-compliant"**: a tool can pass all five tests and still be run unlawfully (no record of processing, no legal basis). Compliance describes a deployment, never the software in isolation.
- **"Privacy-first"**: a slogan, not something you can test.

## How to apply the list

Evaluating a concrete AI tool takes six steps:

1. Visit the vendor's site. Do "local" or "on-device" appear on the landing page — and if so, with specifics (which model, running where)?
2. Observe traffic across import, indexing and chat with sample material. Record any processing destination outside the device, including servers on the LAN.
3. Locate originals, extracted text, indices and working copies; check encryption and backups.
4. Go through the settings: is telemetry present, switchable, and what is the default?
5. Find the repository link on the website — and check the date of the latest release.
6. Look at cloud sync options: opt-in or opt-out?

Keep the observations with the app version and settings. Repeat relevant checks when a provider, storage mode or version changes.

## How LokLM relates to the list

LokLM is an [on-device application](/en/local-ai) for Windows, Linux and macOS. The bundled model path processes locally through `llama.cpp` after model downloads and does not require an external AI account. Unlocking the local vault is a separate authentication step. The source is public on GitHub[^5].

The current development code stores workspace records in encrypted SQLite and uses a separate vector store, rather than storing the vector index as a SQLite file. By default, vector data is encrypted at rest, with a **local plaintext working directory while the workspace is open**. An optional unencrypted vector-storage mode exists for non-sensitive collections. Imported original files remain in their original locations and are not encrypted by LokLM. Device protection and backup settings therefore still matter.

Optional Ollama providers can handle chat, embeddings or reranking. Selecting a server on another machine sends the corresponding inputs there; current development code requires explicit approval of that destination. The bundled path has no application telemetry, but model downloads and update checks are network activity. Inspect your actual settings and workflows instead of inferring all behaviour from the word “local.”

These product details were checked against the development source on **7 October 2026**. Your installed release, including 0.7.0, may differ; this is not a claim that unreleased changes have already shipped. The [PDF source-checking guide](/en/blog/pdf-ai-source-checking) addresses the separate question of whether an answer is supported by its documents.

## Further in the cluster

For the legal thread: the next article in the series treats [GDPR obligations when feeding documents into cloud LLMs](/en/blog/gdpr-and-llm-data-export) (Arts. 44 ff. — third-country transfer).

For the technical foundations beneath these properties: the [full architecture](/en/architecture) covers hybrid retrieval, the embedding model for German text, and the storage strategy.

To try LokLM yourself: the [download](/en#download) requires neither an account nor an email address.

---

[^4]: For example, on embedding inversion: Morris et al., "Text Embeddings Reveal (Almost) As Much As Text", arXiv:2310.06816. https://arxiv.org/abs/2310.06816

[^5]: LokLM source code repository: https://github.com/TwoD97/LokLM
