---
title: 'GDPR and the LLM: pasting documents into ChatGPT is a data-export event'
description: 'What happens legally when client files or research drafts get pasted into a cloud LLM — third-country transfer (Arts. 44–49 GDPR), lawful basis, and processor/controller in a practical reading.'
lang: 'en'
translationKey: 'gdpr-llm-data-export'
pubDate: 2026-05-28
tags: ['local-ai', 'gdpr', 'privacy']
---

> **Note:** First draft — will be reviewed by someone with legal qualifications before publication. This text is not legal advice.

This article names ChatGPT directly. That is intentional, because the legal situation is best described in terms of actual user behaviour: documents get pasted into ChatGPT because the tool is popular and within easy reach. The analysis itself applies to any cloud LLM with servers outside the EU — Claude, Gemini, Copilot, Perplexity, and many others. ChatGPT stands here as an example of a practice, not as a competitor in a comparison.

Anyone pasting client files, research drafts, or confidential business documents into a field of that kind triggers more legally than the word "paste" suggests. It is a transmission. That is the point of this article.

## What happens technically

When text is pasted into ChatGPT and the request is sent, the following sequence runs:

1. The text leaves the user's end device.
2. It is transmitted via HTTPS to a server cluster operated by OpenAI — in the United States[^1].
3. A language model processes it there.
4. A response is sent back.
5. Request and response are stored for a time, depending on settings and tier.

Step 2 is the legally relevant one. Its name is **third-country transfer**.

## Third-country transfer under Art. 44 GDPR

The GDPR regulates the transfer of personal data to countries outside the European Economic Area in Arts. 44 ff. Such countries are called **third countries** in the regulation's vocabulary. The United States is a third country in the sense of the GDPR.

A transfer to a third country is only permitted when one of the three mechanisms in Chapter V applies (Art. 44 GDPR):

- **Adequacy decision** (Art. 45) — the European Commission declares the data protection level of a third country adequate.
- **Appropriate safeguards** (Art. 46) — standard contractual clauses (SCC), binding corporate rules (BCR), codes of conduct.
- **Derogations for specific situations** (Art. 49) — consent of the data subject, contract performance, vital interests.

Without one of these mechanisms, the transfer is unlawful — regardless of encryption, technical safeguards, or contractual assurances.

### Current status for the United States: Data Privacy Framework

For the United States, the **EU-US Data Privacy Framework** has been in force since July 2023[^2]: an adequacy decision under Art. 45 GDPR for companies that have self-certified. OpenAI is listed[^3].

The framework is legally contested. NOYB and other privacy organisations have filed challenges; two predecessor mechanisms (Safe Harbor 2015, Privacy Shield 2020) were previously struck down by the European Court of Justice. Anyone relying on the framework should know that uncertainty is built into its construction.

While the decision stands, a transfer to a DPF-certified US recipient can be based on Art. 45 GDPR. If the decision falls — and that can happen overnight with a CJEU ruling —, the legal basis disappears and recipients must fall back on SCCs with additional measures (a Transfer Impact Assessment).

## Lawful basis under Art. 6 GDPR

Before the third-country-transfer question comes a prior one: on what lawful basis is the processing happening at all? Art. 6(1) GDPR lists six possible bases:

- **a) Consent** — from the data subject, freely given, informed, withdrawable at any time.
- **b) Performance of a contract** — processing is necessary to perform a contract with the data subject.
- **c) Legal obligation** — statutory requirement.
- **d) Vital interests** — emergencies.
- **e) Public interest** — state functions.
- **f) Legitimate interests** — balancing the controller's interest against the data subject's rights.

For processing a client document in ChatGPT, c), d) and e) are usually out of scope. The candidates are a), b) and f).

**a) Consent:** the client would have to explicitly consent to processing of their personal data by a US company. A boilerplate clause in a retainer agreement will hardly meet the requirements of voluntariness and informedness — especially when the client does not know what happens technically.

**b) Performance of a contract:** a retainer agreement obliges the lawyer to provide advice, not to do so using a specific tool. The performance can be achieved with other means. _Necessary_ in the sense of b) is therefore usually not met.

**f) Legitimate interests:** the most common basis invoked in practice. It requires a three-step test: legitimate interest, necessity, balancing against data subject rights. For confidential client or patient data, the balancing tends to favour the data subject — the expectation that one's own files are not transmitted to US providers is justified.

## Controller and processor

A second layer: the role allocation under Art. 4(7) and 4(8) GDPR.

- **Controller** — the party that decides on the purposes and means of processing. In a law firm: the lawyer or the firm.
- **Processor** — the party that processes on behalf of the controller, without independently deciding on the purposes.

When a lawyer sends client data to OpenAI, OpenAI is typically a **processor**. Art. 28 GDPR then applies: a **data processing agreement (DPA)** must exist between lawyer and OpenAI, covering at least the contents required by Art. 28(3).

OpenAI offers standardised DPAs for business tiers (Team, Enterprise, API platform)[^4]. The free and Plus tiers generally do not include a DPA — those tiers are primarily aimed at individual users.

**Practical consequence:** Anyone using a personal ChatGPT account (Plus tier at $20/month) in a professional context and pasting client documents into it usually has **no DPA with OpenAI**. A requirement of Art. 28 GDPR is therefore missing. The processing is in that constellation typically unlawful — regardless of whether the third-country-transfer mechanism is in order.

## An additional layer: professional secrecy

For lawyers, physicians, tax advisors, and psychotherapists, **professional secrecy** is a separate duty regime that runs **in parallel** with the GDPR. In Germany:

- **§ 43a(2) BRAO** — duty of confidentiality for lawyers.
- **§ 203 StGB** — criminal liability for breaching private secrets, including by lawyers, physicians, tax advisors.

§ 203 StGB differs from the GDPR on one decisive point: it is **criminal law**. Breaches are offences, not just regulatory violations. The covered class of persons is narrower, the threshold for "revealing" is lower.

Transmission to a cloud provider can constitute revealing in the sense of § 203 StGB — even with a DPA in place and a third-country-transfer mechanism in order. The requirements for "assisting persons" (§ 203(4) StGB) must be satisfied: a duty of confidentiality, usually in writing, that the US company would have to accept.

In practice, no clear standard has emerged for this. Some German states publish guidance, some bar associations explicitly advise against cloud LLMs for client data[^5]. The situation is in flux; a call to the relevant bar association before introducing a tool is not redundant.

## What a law firm (or consultancy) needs to check

Six questions before using a cloud LLM for professional content:

1. **Lawful basis:** which letter of Art. 6(1) GDPR carries the processing? Is the choice documented?
2. **DPA:** is there a data processing agreement with the vendor? Does it meet Art. 28(3) GDPR?
3. **Third-country-transfer mechanism:** does an adequacy decision (DPF) apply — and is the vendor certified? Otherwise, are SCCs in place? Was a Transfer Impact Assessment performed?
4. **Professional secrecy:** has the relevant bar been consulted? Are assisting persons in the sense of § 203(4) StGB bound in writing?
5. **Client transparency:** have data subjects been informed (Arts. 13/14 GDPR)? Can they object?
6. **Data protection impact assessment (Art. 35):** required for extensive processing of sensitive data. Was it performed?

In a typical setup using a personal ChatGPT Plus subscription, at least four of these six are unanswered. That makes the constellation legally vulnerable.

## What changes with local processing

When processing happens **fully on the end device** — no text travels to an external server — questions 2 and 3 fall away entirely. There is no processor, because no one works with the data other than the controller. There is no third-country transfer, because the data never reaches a third country.

Questions 1, 4, 5, and 6 remain in place. GDPR does not vanish through locality — it merely applies through a considerably narrower set of questions.

That is the actual difference between a cloud LLM and an on-device solution. Not "more" or "less" data protection, but **a different number of questions to answer**.

## Further in the cluster

The first article in this series defined the [five properties of local AI](/en/blog/what-private-actually-means). The second covered the [position of local AI under the EU AI Act](/en/blog/on-device-ai-under-the-eu-ai-act). This third one closes the legal-foundations round.

The [local-AI pillar page](/en/local-ai) collects all three articles. For the technical architecture underpinning on-device processing in practice, see the [architecture page](/en/architecture).

To try LokLM: [download](/en/#download), no account, no email required.

---

[^1]: OpenAI Privacy Policy: https://openai.com/policies/privacy-policy/

[^2]: Adequacy decision EU-US Data Privacy Framework, Commission Implementing Decision (EU) 2023/1795: https://eur-lex.europa.eu/eli/dec_impl/2023/1795/oj

[^3]: Data Privacy Framework Listing (public list of self-certified US companies): https://www.dataprivacyframework.gov/list

[^4]: OpenAI Data Processing Addendum: https://openai.com/policies/data-processing-addendum/

[^5]: For example, guidance from the German Federal Bar Association on the use of AI applications: https://www.brak.de/
