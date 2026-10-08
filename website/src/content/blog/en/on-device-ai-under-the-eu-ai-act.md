---
title: 'On-device AI under the EU AI Act'
description: 'How the EU AI Act applies to local AI: provider and deployer roles, use-case risk, transparency, AI literacy and the limits of open-source exceptions.'
lang: 'en'
translationKey: 'eu-ai-act-on-device'
pubDate: 2026-05-28
updatedDate: 2026-10-07
tags: ['local-ai', 'eu-ai-act', 'gdpr']
---

Running a model on your own computer changes its data flows. It does not create a general exemption from the EU AI Act. For a professional rollout, the useful starting points are your role, the system’s intended purpose and what happens to its outputs.

This overview was reviewed on 7 October 2026 and is not an individual legal assessment. Application dates and transition rules differ across obligations and have changed since the Act was adopted. Use the Commission’s [current implementation timeline and links to the amending legislation](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai) when planning a deployment.

## Identify your role

An organisation using a vendor’s AI application for work will generally be a **deployer**. A **provider** develops a system, or has it developed, and markets it or puts it into service under its own name. Building or distributing a branded integration can therefore change the assessment; simply hosting a chatbot does not settle the role. These definitions come from [Article 3](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-3).

Natural persons using AI for purely personal, non-professional activity are outside the deployer obligations under [Article 2(10)](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-2). That exception does not cover a firm merely because its software runs on laptops.

## Assess the use case, not the profession

Local document search and screening job applicants serve different purposes. The Commission’s [risk overview](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai) identifies employment, certain public services and judicial uses among the areas requiring high-risk assessment. Neither “law firm” nor “public authority” determines the classification of every tool it uses.

For rollout, document the intended use and assess the applicable Article 6 conditions and exceptions. Do not infer low risk from local hosting, or claim high-risk compliance from a product description.

## Article 50 separates several duties

For text assistants, three distinctions matter:

- **Direct interaction:** providers must inform people that they are interacting with AI unless this is obvious in context. The exception is not simply “the tool is internal”. See the Commission’s [Article 50 FAQ](https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act).
- **Technical marking:** Article 50(2) addresses providers of synthetic-content systems, including text. It requires machine-readable marking and detectability, subject to its technical conditions and editing exceptions. Local execution alone is no exemption. See [Article 50](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-50).
- **Publication:** Article 50(4) also covers text published to inform the public on matters of public interest, not only deepfakes. The text-disclosure exception requires human review or editorial control **and** a person holding editorial responsibility. It is not an automatic labelling rule for every internal draft. See [Article 50(4)](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-50).

The Commission’s [transparency guidelines](https://digital-strategy.ec.europa.eu/en/policies/guidelines-ai-transparency-obligations) explain scope and exceptions. They are implementation guidance; the linked legislation remains the legal basis. For dates, the [Commission FAQ](https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act) distinguishes general application from the limited Article 50(2) transition for older systems.

## Local teams still need AI literacy

[Article 4](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-4) requires providers and deployers to take measures supporting AI literacy, considering staff knowledge and the context of use. It does not require guaranteeing a specific competence level for every individual.

For a document assistant, practical training can cover incomplete retrieval, incorrect answers, misleading citations and when to check an original document. Assigning a reviewer is more useful than treating a fluent answer as an approved conclusion.

## Open source and voluntary codes are not blanket exemptions

[Article 2(12)](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-2) concerns free and open-source **AI systems**. Its exemption does not extend to systems falling under high-risk rules, Article 5 or Article 50. Rules for general-purpose AI model providers are a separate question.

[Article 95](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-95) encourages voluntary codes of conduct. The [GPAI Code of Practice](https://digital-strategy.ec.europa.eu/en/policies/ai-code-practice) is a separate compliance tool for model providers under Article 56. Voluntary participation does not make underlying legal duties optional.

## A practical rollout record

For a team introducing LokLM, keep a short record of:

1. Intended tasks, users and decisions the tool may support.
2. Role and risk assessment, with the applicable implementation dates.
3. Staff instruction, source-checking and output-review responsibilities.
4. Any public-facing interaction or publication that needs a transparency assessment.
5. Data access, backups, retention and optional external services.

GDPR and professional confidentiality remain separate requirements. Local processing can reduce external disclosure; it does not automatically satisfy either regime. Our [GDPR and cloud-LLM article](/en/blog/gdpr-and-llm-data-export) explains those distinctions.

Use the [architecture](/en/architecture) and [local-AI guide](/en/local-ai) to assess LokLM’s technical boundary. This article does not certify a particular deployment as legally compliant.
