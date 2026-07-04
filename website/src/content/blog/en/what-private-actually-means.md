---
title: 'What "private" actually means for an AI assistant'
description: 'A checklist of five testable properties — how to measure whether an AI tool is genuinely private. With GDPR and EU AI Act references.'
lang: 'en'
translationKey: 'private-definition'
pubDate: 2026-05-28
tags: ['local-ai', 'gdpr', 'privacy']
---

Hardly a product page in the AI market goes without the word "private" anymore — and hardly any two of them use it to mean the same thing. A cloud provider saying "private" usually means "your inputs won't be used for training, promise." A browser plug-in means "we encrypt the connection." An on-device system means "the text never leaves your machine."

Three claims, superficially interchangeable. Underneath, three entirely different facts.

For anyone bringing AI tools into a law firm, a research group, or a consultancy, this vagueness is a real hazard. The failure mode is not vendor malice — it is a purchase in which "private" quietly meant one thing to the buyer and another to the seller, and the resulting system falls short of the buyer's confidentiality obligations.

What follows is an attempt at precision: a definition built from five properties, each of which can be tested independently. Put any piece of software through the list, and you know exactly what you are holding.

## Why the question is not legally trivial

Search the General Data Protection Regulation for the word "private" and you find nothing. What the regulation knows is **personal data** (Art. 4(1) GDPR[^1]) and **processing** (Art. 4(2) GDPR). As soon as an AI system processes personal content — a client letter, an email thread, a contract draft — Arts. 5, 24, and 32 GDPR engage: a legal basis is required, technical and organizational measures are required, records of processing are required.

The EU AI Act adds a second layer; it has been in force since August 2024, with obligations arriving on a staggered timetable[^2]. For the typical end-user tool, the relevant piece is Art. 50 on transparency: people must be able to tell that they are dealing with an AI system, and which outputs it generated.

Together, the two texts yield a sobering conclusion: printing "private" on a landing page establishes nothing about whether the underlying processing is **lawful**. "Private" carries no legal weight at all. It is marketing vocabulary — sometimes an accurate summary of a technical reality, sometimes a fog around one.

## The five properties

Here are the five properties that have to hold together before "private" stops being an atmosphere and becomes a claim you can test.

### 1. On-device inference

**Answer generation happens on the end device itself.** Nothing goes out to a server, no API is called, no reverse tunnel is opened.

Testing it: run a network monitor, submit a question, and watch what leaves the machine. If the system is genuinely local, inference generates zero outbound traffic — a single update check at launch being the acceptable exception.

The distinction is anything but pedantic. "We encrypt what we send to our servers" and "we send nothing to our servers" sit in different legal worlds. The former is processing through a processor under Art. 28 GDPR — which drags in a data processing agreement, an entry in the records, and potentially a third-country transfer mechanism[^3]. The latter involves no third party at all.

### 2. Local index, local storage

Running AI over one's own documents — retrieval-augmented generation, RAG — produces **vector embeddings**: numerical encodings of the texts, used to locate similar passages. An embedding is a derivative of the document. It is anything but innocuous.

So: **where do the embeddings end up?** A tool that advertises "local AI" while pushing embeddings to a cloud server has not eliminated the confidentiality problem — it has relocated it. Whoever possesses the embeddings can recover a great deal about the underlying text; the embedding-inversion literature leaves little doubt[^4].

Testing it: index a document, then look inside the application's data directory for a file-backed database (a SQLite file, a vector store). Finding one raises the follow-up: is it actually local? Both questions carry equal weight.

### 3. No telemetry

Modern software phones home by default: small packets describing usage, crashes, and device characteristics flow automatically back to the vendor. It is widespread, frequently anonymized, and genuinely handy for debugging.

In a confidential setting, it is a liability. Telemetry anonymization is flimsier than its reputation — device fingerprints combined with usage patterns often suffice to re-identify someone. And the GDPR draws no line between "content" and "metadata": either can be personal data.

Testing it: the network monitor again. A tool that claims full locality should stay silent on the wire over long working sessions. As a bonus check: do the settings expose a telemetry switch, and which way does it point out of the box?

### 4. Auditable code

This property differs in kind from the previous three. Points 1 through 3 are observations of behaviour — and behaviour can flip with any update.

Publicly available source code — open source — lets a motivated third party (or a hired security firm) check the behavioural claims against what the code actually does. Closed software leaves you with nothing but the brochure.

Auditable does not mean audited. Open code is no security guarantee; what it provides is the possibility of verification. And that possibility is the only mechanism by which a confidentiality claim survives over time: not because someone promised, but because anyone can check.

Testing it: hunt for a repository link on the vendor's site — for open-source projects, usually GitHub or GitLab. If no link turns up, open code probably does not exist.

### 5. No background synchronisation

The last property is the easiest to miss. Plenty of nominally "local" software quietly syncs settings, chat histories, or templates against a cloud account run by the same vendor — sold as convenience. From the first sync onward, the system no longer satisfies property 1's sense of "local."

Testing it: comb the settings for anything labelled account, sync, or cloud. Where such options exist, the default matters: a tool that syncs nothing until asked (opt-in) behaves fundamentally differently from one that syncs until stopped (opt-out).

## Why the list is neither longer nor shorter

The five properties are not arbitrary: they enumerate the routes by which data can escape a device or be reconstructed afterwards. Four egress routes exist — inference (1), persisted index data (2), telemetry (3), and sync (5). Property 4, auditability, is the structural backstop that keeps the other four verifiable as the software evolves.

Some criteria that other definitions include are left out here on purpose:

- **"Encrypted"**: encryption is silent on the decisive question — who holds the key. Necessary, never sufficient.
- **"GDPR-compliant"**: a tool can pass all five tests and still be run unlawfully (no record of processing, no legal basis). Compliance describes a deployment, never the software in isolation.
- **"Privacy-first"**: a slogan, not something you can test.

## How to apply the list

Evaluating a concrete AI tool takes six steps:

1. Visit the vendor's site. Do "local" or "on-device" appear on the landing page — and if so, with specifics (which model, running where)?
2. Watch the network monitor during a test query: does anything leave the LAN? (Update checks aside.)
3. After indexing, open the application data directory: has a local file database appeared?
4. Go through the settings: is telemetry present, switchable, and what is the default?
5. Find the repository link on the website — and check the date of the latest release.
6. Look at cloud sync options: opt-in or opt-out?

Steps 1, 2, and 6 fit into ten minutes. Steps 3, 4, and 5 demand a little more patience — and complete the picture.

## How LokLM relates to the list

LokLM is an [on-device application](/en/local-ai) for Windows and macOS. Inference runs locally via `llama.cpp`, the vector index is a SQLite file in the application data directory, and there is neither telemetry nor an account. The source code is public on GitHub[^5].

As for point 5 — background sync — LokLM has nothing to test: no cloud component exists that anything could sync with.

That is the honest self-assessment. Other tools meet other subsets of the list, which is stated here as observation, not verdict. The point of the checklist is precisely that every reader can determine which subset their own use case demands.

## Further in the cluster

For the legal thread: the next article in the series treats [GDPR obligations when feeding documents into cloud LLMs](/en/blog/gdpr-and-llm-data-export) (Arts. 44 ff. — third-country transfer).

For the technical foundations beneath these properties: the [full architecture](/en/architecture) covers hybrid retrieval, the embedding model for German text, and the storage strategy.

To try LokLM yourself: the [download](/en/#download) requires neither an account nor an email address.

---

[^1]: Regulation (EU) 2016/679 — General Data Protection Regulation. Consolidated text at EUR-Lex: https://eur-lex.europa.eu/eli/reg/2016/679/oj

[^2]: Regulation (EU) 2024/1689 — Regulation on Artificial Intelligence (AI Act). https://eur-lex.europa.eu/eli/reg/2024/1689/oj

[^3]: Overview of Standard Contractual Clauses (SCC) and third-country transfer rules at the European Data Protection Board: https://www.edpb.europa.eu/

[^4]: For example, on embedding inversion: Morris et al., "Text Embeddings Reveal (Almost) As Much As Text", arXiv:2310.06816. https://arxiv.org/abs/2310.06816

[^5]: LokLM source code repository: https://github.com/TwoD97/LokLM
