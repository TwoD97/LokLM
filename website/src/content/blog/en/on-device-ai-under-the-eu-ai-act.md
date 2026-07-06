---
title: 'On-device AI under the EU AI Act'
description: 'Where locally running AI systems sit in the EU AI Act — a reading of Articles 6, 50, and 95. With role logic and practice notes for DACH law firms and research groups.'
lang: 'en'
translationKey: 'eu-ai-act-on-device'
pubDate: 2026-05-28
tags: ['local-ai', 'eu-ai-act', 'gdpr']
---

_This article is not legal advice._

Since 1 August 2024, the EU AI Act (Regulation 2024/1689[^1]) has been in force, with its duties phasing in over time: certain prohibitions since February 2025, obligations for general-purpose AI models since August 2025, and the bulk of the high-risk regime from August 2026. The regulation was drafted with big AI systems in mind — a provider hosts them, a deployer uses them, notified bodies certify them.

Which leaves anyone running a model on their own laptop with a fair question: does any of this reach me? Am I a provider here? A deployer? Do I owe a transparency notice to an audience of one — myself?

Three provisions carry the answer, and this article takes them in turn: **Article 6** (high-risk classification), **Article 50** (transparency obligations), and **Article 95** (codes of practice). Not everything applies to everyone; the useful skill is telling which obligations genuinely attach and which do not.

## The role logic of the AI Act

Everything in the AI Act hangs on role assignment. Art. 3 nos. 3–7 distinguish four roles, and the assignment determines the obligations.

- **Provider**: whoever — natural or legal person — develops an AI system or commissions its development, and places it on the EU market or puts it into service under their own name or trade mark.
- **Deployer**: whoever uses an AI system under their own authority, unless the use is personal and non-professional.
- **Importer**: the EU-side representative for providers established outside the Union.
- **Distributor**: whoever makes the system available on the market without being provider or importer.

Applied to an on-device tool like LokLM, the mapping is straightforward. The software vendor holds the provider role. A law firm, a research group, or a tax consultancy that installs and uses the software is a deployer — because the use is professional.

A private person running LokLM at home over their own texts benefits from the carve-out for purely personal, non-professional activity: they are not a deployer under the Act and carry no deployer duties.

## Article 6: high-risk classification

Whether a system counts as **high-risk** is settled by Article 6, and there are two ways in:

- **Path 1 (Art. 6(1)):** the system serves as a safety component of a product regulated by one of the EU harmonisation acts in Annex I — medical devices, machinery, toys, and so on. A local RAG tool for text documents does not plausibly enter through this door.
- **Path 2 (Art. 6(2) in conjunction with Annex III):** the system is deployed in one of Annex III's listed fields. Annex III enumerates eight of them — among others the administration of justice (letter h), law enforcement, migration and border control, and critical infrastructure.

Annex III no. 8 letter (a) covers systems "intended to assist a judicial authority in researching and interpreting facts and the law and in applying the law to a concrete set of facts." Note the subject: a judicial authority. A law firm is private professional practice, not a judicial authority, so letter (a) will generally not capture a firm's use.

**Practical consequence:** in most configurations, a firm searching its own documents with a local AI tool is not operating a high-risk system under Annex III. The calculus flips inside a law enforcement agency or a migration authority — there the high-risk duties of Arts. 8 ff. do engage.

One caveat: this is purely a classification result. GDPR duties, professional-conduct rules, and confidentiality obligations are untouched by it — they operate in parallel, on their own terms.

## Article 50: transparency obligations

For end users, the provision that matters most in practice is Article 50, because its duties can apply whether or not anything is classified high-risk.

Three of its obligations deserve a check when local AI is involved:

### 50(1): direct interaction with people

> "Providers shall ensure that AI systems intended to interact directly with natural persons are designed and developed in such a way that the natural persons concerned are informed that they are interacting with an AI system."

The addressee here is the **provider**, not the person at the keyboard. Someone using local AI purely for their own work — with no third party on the other end — is simply not who this provision speaks to. But someone who wires local AI into a chatbot on their own website, where it talks to clients or customers, has become the provider of that system in the regulation's sense and owes the disclosure.

### 50(2): synthetic content

> "Providers of AI systems, including general-purpose AI systems, generating synthetic audio, image, video, or text content, shall ensure that the outputs of the AI system are marked in a machine-readable format and detectable as artificially generated or manipulated."

The provision aims at watermarking and provenance signals for generated media. Whether the output of a local tool that summarises documents or answers questions over a user's own files counts as "synthetic text content" here is genuinely unresolved. Recitals 132–135 suggest the drafters had deepfakes and consumer-facing generation in view. As of 2026, no settled enforcement practice exists on the point.

### 50(4): deepfakes and politically relevant content

> "Deployers of an AI system that generates or manipulates image, audio, or video content constituting a deepfake shall disclose that the content has been artificially generated or manipulated."

For a local text tool that produces neither images nor audio, this one stays out of frame.

## Article 95: codes of practice

Article 95 asks the Commission and the AI Board to encourage the development of **codes of practice** — voluntary commitments that systems below the high-risk threshold can sign up to, covering topics like environmental footprint, data ethics, or accessibility.

The key word is voluntary. Where Arts. 6 and 50 impose duties, Article 95 offers an option. A vendor of local AI software may adopt such a code as a trust signal — or decline, with no legal consequence.

Article 95 gains practical weight for local AI once the first general-purpose AI code of practice lands (the Commission circulated a draft in early 2025[^2]). Open-source vendors can treat it as a barometer of which voluntary commitments are hardening into industry norms — and align by choice, not by mandate.

## Where the AI Act is silent

Three matters the AI Act leaves untouched — whether by design or oversight — that stay central to local AI in practice:

1. **Data protection.** The AI Act supplements the GDPR; it does not supersede it. Whoever processes personal data still owes everything in Arts. 5, 24, 32 GDPR[^3], AI Act or no AI Act. Local processing shifts the GDPR analysis only at one spot: nothing travels to a cloud provider, so Arts. 44 ff. GDPR stay dormant. The rest of the regulation applies unchanged.
2. **Professional confidentiality.** Lawyers (§ 43a BRAO in Germany), physicians (§ 203 StGB), tax advisors, and comparable professions carry secrecy duties that exist independently of both GDPR and AI Act. In these settings, locally running AI is frequently the only defensible option — a cloud transmission would carry the data outside the protected circle of confidentiality.
3. **Open-source exception.** Art. 2(12) AI Act exempts open-source AI models, provided they are not placed on the market or put into service as part of a high-risk or prohibited system. For open-source tools this raises the regulatory threshold considerably; Recitals 102–104 spell out the details.

## A practical case: a law firm rolls out LokLM

Take a mid-sized firm that wants to search its client documents locally and installs LokLM across its workstations. Run the AI Act over that scenario:

- **Role:** the firm acts as deployer; LokLM's vendor acts as provider.
- **High risk (Art. 6):** Annex III letter h speaks of judicial authorities, and private legal practice is not one. No high-risk classification.
- **Transparency (Art. 50):** the interaction stays inside the firm. Clients need not be told that AI assists with research behind the scenes — provided the firm does not pass AI outputs to clients as AI-generated. A firm that sends a client an AI-drafted letter without lawyer review has a professional-conduct problem in any event, AI Act or not.
- **Confidentiality (§ 43a BRAO):** processing on-premises keeps the circle of confidentiality closed; a cloud transmission would open it.
- **GDPR:** where the processing is extensive or particularly risky, the firm must run a data protection impact assessment (Art. 35 GDPR) — which is entirely feasible for local processing too.

The takeaway: in the standard configuration, nothing in the AI Act stands between a law firm and a local AI solution, and no AI-Act-specific extra duties attach. The genuinely hard questions live elsewhere — in professional law and in the GDPR, both of which run their own course in parallel.

## Further in the cluster

This article belongs to the local-AI series that opened with the [definition of "private"](/en/blog/what-private-actually-means). The next instalment takes up in depth what this one only brushed: the GDPR consequences of feeding documents into cloud LLMs.

All articles in the series are collected on the [local-AI pillar page](/en/local-ai); the technical foundations live on the [architecture page](/en/architecture).

To try LokLM: [download](/en/#download), no account, no email required.

---

[^1]: Regulation (EU) 2024/1689 — Regulation on Artificial Intelligence (AI Act). Full text at EUR-Lex: https://eur-lex.europa.eu/eli/reg/2024/1689/oj

[^2]: Current status of the European Commission's General-Purpose AI Code of Practice: https://digital-strategy.ec.europa.eu/en/policies/ai-code-practice

[^3]: Regulation (EU) 2016/679 — General Data Protection Regulation. Consolidated text: https://eur-lex.europa.eu/eli/reg/2016/679/oj
