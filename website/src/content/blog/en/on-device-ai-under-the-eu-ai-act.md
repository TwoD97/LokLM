---
title: 'On-device AI under the EU AI Act'
description: 'Where locally running AI systems sit in the EU AI Act — a reading of Articles 6, 50, and 95. With role logic and practice notes for DACH law firms and research groups.'
lang: 'en'
translationKey: 'eu-ai-act-on-device'
pubDate: 2026-05-28
tags: ['local-ai', 'eu-ai-act', 'gdpr']
---

> **Note:** First draft — the legal assessment will be reviewed by someone with legal qualifications before publication. This text is not legal advice.

The EU AI Act (Regulation 2024/1689[^1]) has been in force since 1 August 2024. Its obligations apply on a staggered schedule: some prohibitions from February 2025, general-purpose AI model obligations from August 2025, high-risk obligations mostly from August 2026. The regulation is built around large AI systems — hosted by a provider, used by a deployer, certified by notified bodies.

Anyone running AI locally on their own laptop reasonably asks: am I in scope at all? Am I a provider? A deployer? Do I have to make a transparency disclosure if I am the only user?

This article works through three points. **Article 6** (high-risk classification), **Article 50** (transparency obligations), and **Article 95** (codes of practice). They are not equally relevant to everyone — the point is to recognise which obligations actually apply and which do not.

## The role logic of the AI Act

The AI Act draws sharp distinctions between four roles (Art. 3 nos. 3–7 AI Act). The classification decides which obligations apply.

- **Provider**: a natural or legal person who develops an AI system, or has one developed, and places it on the EU market or puts it into service under their own name or trade mark.
- **Deployer**: any natural or legal person who uses an AI system under their authority, except in the course of a personal, non-professional activity.
- **Importer**: providers established in a third country are represented in the EU by an importer.
- **Distributor**: makes the system available on the market without being a provider or importer.

For an on-device system like LokLM, that produces a clear allocation. The software vendor is the provider. Anyone deploying the software in a law firm, a research group, or a tax consultancy is a deployer — as long as the use is professional.

A private individual experimenting with LokLM at home on their own texts falls under the exception for purely personal, non-professional use and is not a deployer in the sense of the Act. They have no deployer obligations.

## Article 6: high-risk classification

Article 6 of the AI Act decides when an AI system counts as a **high-risk system**. The classification follows two paths:

- **Path 1 (Art. 6(1)):** the system is a safety component of a product covered by one of the EU harmonisation laws listed in Annex I (e.g., medical devices, machinery, toys). For a local RAG tool for text documents, this path is generally not relevant.
- **Path 2 (Art. 6(2) in conjunction with Annex III):** the system is used in one of the areas listed in Annex III. Annex III names eight areas, including the administration of justice (letter h), law enforcement, migration and border control, critical infrastructure.

Annex III no. 8 letter (a) explicitly names systems "intended to assist a judicial authority in researching and interpreting facts and the law and in applying the law to a concrete set of facts." A law firm is not a judicial authority — it is private professional practice. Letter (a) therefore generally does not apply to a law firm's use.

**Practical consequence:** a law firm using a local AI tool for internal document research is in most constellations not deploying a high-risk system in the sense of Annex III. The picture is different when an AI tool is used inside a law enforcement agency or a migration authority — there, the high-risk obligations of Arts. 8 ff. apply.

This assessment concerns classification only. It says nothing about GDPR obligations, professional duties, or confidentiality duties — those run in parallel and independently.

## Article 50: transparency obligations

Article 50 AI Act is the provision most often relevant for end users, because its obligations frequently apply even without a high-risk classification.

Three obligations from Article 50 typically need to be checked for local AI:

### 50(1): direct interaction with people

> "Providers shall ensure that AI systems intended to interact directly with natural persons are designed and developed in such a way that the natural persons concerned are informed that they are interacting with an AI system."

This duty falls on the **provider**, not the individual user. Anyone using local AI only for themselves — i.e., not in interaction with others — is not addressed. Anyone deploying local AI in a chatbot on their own website that interacts with clients or customers is in fact the provider of that system within the meaning of the regulation and must make the disclosure.

### 50(2): synthetic content

> "Providers of AI systems, including general-purpose AI systems, generating synthetic audio, image, video, or text content, shall ensure that the outputs of the AI system are marked in a machine-readable format and detectable as artificially generated or manipulated."

The aim is watermarking and provenance markers for generated content. For a local tool that summarises texts or answers questions from a user's own documents, it is open whether the output counts as "synthetic text content" in the sense of the provision. Recitals 132–135 show that the legislator primarily targeted deepfakes and consumer-facing generation. As of 2026, there is no settled enforcement practice on this point.

### 50(4): deepfakes and politically relevant content

> "Deployers of an AI system that generates or manipulates image, audio, or video content constituting a deepfake shall disclose that the content has been artificially generated or manipulated."

Not directly relevant to local text tools, as long as no images or audio are generated.

## Article 95: codes of practice

Article 95 AI Act invites the Commission and the AI Board to facilitate **codes of practice** that non-high-risk systems can voluntarily commit to — for example on environmental impact, data ethics, or accessibility.

Unlike the obligations in Arts. 6 or 50, Article 95 is **not mandatory**. It is an incentive instrument. A vendor of local AI software can voluntarily sign such a code to build trust — but is not required to.

For the practice of local AI tools, Article 95 becomes most interesting once the first general-purpose AI code of practice is published (the Commission's draft was available in early 2025[^2]). Open-source vendors can use that to read which voluntary commitments are becoming industry norm — and choose to align if they wish.

## Where the AI Act is silent

Three points the AI Act consciously or unconsciously leaves open — and which remain central for local AI in practice:

1. **Data protection.** The AI Act does not replace the GDPR. It supplements it. Anyone processing personal data still has the obligations from Arts. 5, 24, 32 GDPR[^3] regardless of the AI Act. Local processing changes the GDPR picture only insofar as no transmission to a cloud provider occurs (Arts. 44 ff. GDPR do not apply) — everything else remains.
2. **Professional confidentiality.** For lawyers (in Germany, § 43a BRAO), physicians (§ 203 StGB), tax advisors, and similar professionals, professional secrecy applies. The duty is independent of GDPR and AI Act. Locally running AI is often the only admissible option here, because a cloud transmission would leave the circle of confidentiality.
3. **Open-source exception.** Art. 2(12) AI Act contains an exception for open-source AI models that are not placed on the market or put into service as part of a high-risk or prohibited system. This is a meaningful raise of the threshold for open-source tools — details are in Recitals 102–104.

## A practical case: a law firm rolls out LokLM

A mid-sized law firm wants to search client documents locally. It installs LokLM on its workstations. What does the AI Act say?

- **Role:** the firm is a deployer in the sense of the AI Act. LokLM's vendor is the provider.
- **High risk (Art. 6):** Annex III letter h names judicial authorities — private legal practice is not covered. The system is not high-risk.
- **Transparency (Art. 50):** the firm interacts internally. There is no duty to inform clients that AI helps with research in the background — as long as the AI does not produce outputs the firm passes to clients as AI-generated. The moment a firm hands over an AI-drafted letter to a client without lawyer review, that is in any case a professional-conduct problem independent of the AI Act.
- **Confidentiality (§ 43a BRAO):** local processing keeps the circle of confidentiality intact; cloud transmission would breach it.
- **GDPR:** the firm has to perform a data protection impact assessment if the processing is extensive or particularly risky (Art. 35 GDPR). That is possible with local processing as well.

What this picture shows: in the standard constellation, the AI Act permits a local AI solution in a law firm without additional AI-Act-specific obligations. The difficulty does not sit in the AI Act — it sits in professional law and in the GDPR. Both run in parallel.

## Further in the cluster

This article is part of the local-AI series that started with the [definition of "private"](/en/blog/what-private-actually-means). The next piece will deal specifically with the GDPR when feeding documents into cloud LLMs — touched on here only briefly.

The [local-AI pillar page](/en/local-ai) collects all articles in the series. For the technical underpinnings, see the [architecture page](/en/architecture).

To try LokLM: [download](/en/#download), no account, no email required.

---

[^1]: Regulation (EU) 2024/1689 — Regulation on Artificial Intelligence (AI Act). Full text at EUR-Lex: https://eur-lex.europa.eu/eli/reg/2024/1689/oj

[^2]: Current status of the European Commission's General-Purpose AI Code of Practice: https://digital-strategy.ec.europa.eu/en/policies/ai-code-practice

[^3]: Regulation (EU) 2016/679 — General Data Protection Regulation. Consolidated text: https://eur-lex.europa.eu/eli/reg/2016/679/oj
