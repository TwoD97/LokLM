---
title: 'GDPR and cloud LLMs: roles, data flows and transfers'
description: 'What to check before sending documents to a cloud LLM: lawful basis, processor contracts, international transfers and the limits of local processing.'
lang: 'en'
translationKey: 'gdpr-llm-data-export'
pubDate: 2026-05-28
updatedDate: 2026-10-07
tags: ['local-ai', 'gdpr', 'privacy']
---

Sending a document to a cloud LLM makes its contents available outside your device. That deserves a deliberate assessment, particularly for client files or research data. It does **not** automatically establish either a third-country transfer or a processor relationship.

This overview was reviewed on 7 October 2026. It provides general information, not a legal assessment of a particular organisation or service configuration.

## Start with the data and purpose

Identify the personal data involved, why the AI processing is needed and the applicable lawful basis. Consent is one possibility, not a universal requirement; contract necessity or legitimate interests also need their own conditions assessed. Health and other special-category data require an additional Article 9 condition. A transfer mechanism does not replace a lawful basis. The [EDPB’s lawful-processing guide](https://www.edpb.europa.eu/sme/be-compliant/process-personal-data-lawfully_en) explains these distinctions.

Before rollout, record the actual service, recipient entities, access locations, retention, training uses and connected tools. “ChatGPT” or “cloud AI” alone is not a sufficiently precise description.

For example, eligible ChatGPT Enterprise and Edu configurations offer European storage and inference residency. These are different controls, with feature and processing exclusions; neither means that every operation stays in the selected region. Check [OpenAI’s current residency documentation](https://help.openai.com/en/articles/9903489-data-residency-and-inference-residency-for-chatgpt) for the specific workspace.

## When does Article 28 apply?

A processor handles personal data on a controller’s behalf. A service acting for its own purposes may instead be a controller for that processing. The factual activities determine the role, not encryption or a contractual label alone. Where a processor is engaged, Article 28 requires an appropriate contract or other qualifying legal act. See the [EDPB’s controller and processor guidelines](https://www.edpb.europa.eu/system/files/documents/2023-10/EDPB_guidelines_202007_controllerprocessor_final_en.pdf).

OpenAI publishes a [Data Processing Addendum](https://openai.com/policies/data-processing-addendum/) covering processing under its relevant business agreement. Verify that the agreement actually covers your service and use. A plan name, paid subscription or “no training” setting does not establish compliance by itself.

## When is there an international transfer?

The EDPB identifies three cumulative conditions: an exporter is subject to the GDPR for the processing; it makes personal data available to another controller or processor; and that recipient is in a third country or is an international organisation. Off-device processing alone does not meet that test. See [Guidelines 05/2021](https://www.edpb.europa.eu/system/files/2023-02/edpb_guidelines_05-2021_interplay_between_the_application_of_art3-chapter_v_of_the_gdpr_v2_en_0.pdf).

Where Chapter V applies, assess adequacy, appropriate safeguards such as standard contractual clauses, or a narrowly applicable derogation. Encryption can form part of safeguards but does not independently resolve every transfer requirement. The [EDPB’s transfer guide](https://www.edpb.europa.eu/sme/be-compliant/international-data-transfers_en) explains the available routes.

The Commission’s [current adequacy list](https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/adequacy-decisions_en) includes participating US commercial organisations under the EU–US Data Privacy Framework. Check the particular recipient’s active participation and coverage; this is not blanket adequacy for every US service.

## Confidentiality and risk remain separate questions

German professional secrecy rules require a separate assessment. They do not categorically prohibit every cloud service: [§ 43e BRAO](https://www.gesetze-im-internet.de/brao/__43e.html) addresses lawyers’ use of service providers, including selection, confidentiality and access conditions; [§ 203 StGB](https://www.gesetze-im-internet.de/stgb/__203.html) also regulates participating persons. A GDPR contract alone does not settle professional obligations.

A data protection impact assessment is required where processing is likely to create high risks to people’s rights and freedoms. Neither “uses AI” nor “runs locally” settles that threshold. See the [EDPB’s compliance guidance](https://www.edpb.europa.eu/sme/be-compliant/be-compliant_en).

## What local processing changes

Keeping inference and storage inside your organisation can avoid sending document contents to an external AI provider. Verify that boundary across backups, remote support, optional integrations and exports too.

Local processing still requires a lawful purpose, appropriate access controls, retention decisions and respect for data-subject rights. It can simplify the data flow; it is not a GDPR certificate.

Our [local-AI guide](/en/local-ai) and [architecture](/en/architecture) explain the technical choices. The companion article covers [local AI under the AI Act](/en/blog/on-device-ai-under-the-eu-ai-act).
