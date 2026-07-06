---
title: 'GDPR and the LLM: pasting documents into ChatGPT is a data-export event'
description: 'What happens legally when client files or research drafts get pasted into a cloud LLM — third-country transfer (Arts. 44–49 GDPR), lawful basis, and processor/controller in a practical reading.'
lang: 'en'
translationKey: 'gdpr-llm-data-export'
pubDate: 2026-05-28
tags: ['local-ai', 'gdpr', 'privacy']
---

_This article is not legal advice._

ChatGPT is named explicitly throughout this article, and deliberately so: legal analysis is most useful when it starts from what people actually do, and what people actually do is paste documents into ChatGPT, because it is the tool everyone has open anyway. Everything said below applies equally to any cloud LLM whose servers sit outside the EU — Claude, Gemini, Copilot, Perplexity, and the rest. ChatGPT appears here as shorthand for a habit, not as the target of a product comparison.

The habit itself is the problem. Copying a client file, a research draft, or a confidential memo into such a text field sets off far more legal machinery than the innocuous word "paste" implies. What has happened is a transmission — and that is the whole point of this article.

## What happens technically

Paste text into ChatGPT, press send, and the following chain executes:

1. The text departs from the user's device.
2. It travels over HTTPS to server infrastructure operated by OpenAI — located in the United States[^1].
3. There, a language model runs over it.
4. A reply travels back.
5. Both request and reply are retained for some period, the length depending on tier and settings.

The legally loaded step is number 2. The GDPR has a name for it: **third-country transfer**.

## Third-country transfer under Art. 44 GDPR

Arts. 44 ff. GDPR govern moving personal data to destinations outside the European Economic Area — **third countries**, in the regulation's terminology. The United States is such a third country.

Chapter V allows a third-country transfer only when one of three mechanisms carries it (Art. 44 GDPR):

- **Adequacy decision** (Art. 45) — the European Commission formally finds the third country's data protection level adequate.
- **Appropriate safeguards** (Art. 46) — standard contractual clauses (SCC), binding corporate rules (BCR), codes of conduct.
- **Derogations for specific situations** (Art. 49) — the data subject's consent, contract performance, vital interests.

Absent all three, the transfer is unlawful. Encryption does not cure it; technical measures do not cure it; contractual promises do not cure it.

### Current status for the United States: Data Privacy Framework

Since July 2023, transfers to the United States can rest on the **EU-US Data Privacy Framework**[^2] — an Art. 45 adequacy decision covering companies that have self-certified under it. OpenAI appears on the certification list[^3].

That footing is shakier than it looks. NOYB and other privacy organisations are litigating against the framework, and its two predecessors — Safe Harbor (struck down 2015) and Privacy Shield (struck down 2020) — both fell before the European Court of Justice. Uncertainty is not a bug in this arrangement; it is part of its history.

As long as the decision stands, sending data to a DPF-certified US recipient can rely on Art. 45 GDPR. Should the CJEU annul it — which can happen from one day to the next — that basis evaporates, and recipients are thrown back on SCCs supplemented by additional measures, including a Transfer Impact Assessment.

## Lawful basis under Art. 6 GDPR

The transfer question is actually the second question. The first: what lawful basis supports the processing in the first place? Art. 6(1) GDPR offers exactly six:

- **a) Consent** — given by the data subject, freely, on an informed basis, revocable at any time.
- **b) Performance of a contract** — the processing is necessary to fulfil a contract with the data subject.
- **c) Legal obligation** — a statute requires it.
- **d) Vital interests** — life-or-death situations.
- **e) Public interest** — the exercise of official authority.
- **f) Legitimate interests** — the controller's interest, weighed against the data subject's rights.

Running a client document through ChatGPT rules out c), d), and e) in nearly every scenario. That leaves a), b), and f) as candidates.

**a) Consent:** the client would need to consent, explicitly, to their personal data being processed by a US company. A pre-printed clause buried in an engagement letter is unlikely to clear the bar of voluntariness and informedness — particularly when the client has no idea what technically happens to their file.

**b) Performance of a contract:** an engagement obliges the lawyer to advise, not to advise with any particular tool. Because the same service can be rendered by other means, the _necessity_ that b) demands is normally absent.

**f) Legitimate interests:** the workhorse of practice, and the basis most often claimed. It demands a three-part test — a legitimate interest, necessity, and a balancing against the data subject's rights. Where confidential client or patient material is concerned, that balancing tilts toward the data subject: people are entitled to expect that their files do not end up with US providers.

## Controller and processor

A second layer sits on top: who plays which role under Art. 4(7) and 4(8) GDPR?

- **Controller** — whoever determines the purposes and means of the processing. In a firm, that is the lawyer or the firm itself.
- **Processor** — whoever handles the data on the controller's instructions without setting the purposes independently.

A lawyer who feeds client data to OpenAI typically makes OpenAI a **processor**. Art. 28 GDPR then bites: a **data processing agreement (DPA)** must be in place between lawyer and OpenAI, containing at minimum what Art. 28(3) prescribes.

OpenAI provides standardised DPAs for its business offerings — Team, Enterprise, and the API platform[^4]. The free and Plus tiers, aimed at private individuals, generally come without one.

**Practical consequence:** whoever works professionally out of a personal ChatGPT account (Plus, $20/month) and pastes client documents into it is, as a rule, operating **without a DPA**. One of Art. 28 GDPR's requirements is simply not met. In that configuration the processing is typically unlawful — even if the third-country-transfer side were entirely in order.

## An additional layer: professional secrecy

Lawyers, physicians, tax advisors, and psychotherapists carry **professional secrecy** obligations — a duty regime that operates **alongside** the GDPR, not inside it. In Germany:

- **§ 43a(2) BRAO** — the lawyer's duty of confidentiality.
- **§ 203 StGB** — criminal liability for disclosing private secrets, applicable to lawyers, physicians, tax advisors, among others.

The decisive difference between § 203 StGB and the GDPR: it is **criminal law**. A violation is an offence, not merely a regulatory infraction. The circle of covered persons is smaller, but the threshold for what counts as "revealing" is lower.

Handing data to a cloud provider can amount to revealing under § 203 StGB — a valid DPA and a working transfer mechanism notwithstanding. To avoid it, the conditions for "assisting persons" (§ 203(4) StGB) must be met: a confidentiality obligation, normally in writing, which the US company would have to accept.

No settled market standard for this exists. Some German states have issued guidance; some bar associations advise outright against putting client data into cloud LLMs[^5]. The terrain is moving — a call to the competent bar association before adopting a tool is time well spent.

## What a law firm (or consultancy) needs to check

Before a cloud LLM touches professional content, six questions:

1. **Lawful basis:** which letter of Art. 6(1) GDPR is the processing resting on — and is that choice written down?
2. **DPA:** does a data processing agreement with the vendor exist, and does it satisfy Art. 28(3) GDPR?
3. **Third-country-transfer mechanism:** is an adequacy decision (DPF) available, and is this vendor certified under it? If not, are SCCs in place, and has a Transfer Impact Assessment been done?
4. **Professional secrecy:** has the competent bar been asked? Are assisting persons under § 203(4) StGB bound in writing?
5. **Client transparency:** have the data subjects been informed (Arts. 13/14 GDPR), and can they object?
6. **Data protection impact assessment (Art. 35):** mandatory for large-scale processing of sensitive data — has one been carried out?

Run this checklist against the typical setup — a personal ChatGPT Plus subscription — and at least four of the six come back empty. Legally, that constellation stands on very thin ice.

## What changes with local processing

If the processing stays **entirely on the end device** — no text ever leaves for an external server — questions 2 and 3 simply disappear. No processor exists, since nobody besides the controller touches the data. No third-country transfer occurs, since the data never crosses into a third country.

Questions 1, 4, 5, and 6 survive. Locality does not switch the GDPR off — it shortens the list of questions the GDPR asks.

And that is the real contrast between a cloud LLM and an on-device solution: not "better" or "worse" data protection in the abstract, but **a different number of open questions**.

## Further in the cluster

This series opened by defining the [five properties of local AI](/en/blog/what-private-actually-means), then examined the [position of local AI under the EU AI Act](/en/blog/on-device-ai-under-the-eu-ai-act). With this third piece, the legal-foundations round is complete.

All three articles are gathered on the [local-AI pillar page](/en/local-ai). The technical side — how on-device processing actually works — is covered on the [architecture page](/en/architecture).

To try LokLM: [download](/en/#download), no account, no email required.

---

[^1]: OpenAI Privacy Policy: https://openai.com/policies/privacy-policy/

[^2]: Adequacy decision EU-US Data Privacy Framework, Commission Implementing Decision (EU) 2023/1795: https://eur-lex.europa.eu/eli/dec_impl/2023/1795/oj

[^3]: Data Privacy Framework Listing (public list of self-certified US companies): https://www.dataprivacyframework.gov/list

[^4]: OpenAI Data Processing Addendum: https://openai.com/policies/data-processing-addendum/

[^5]: For example, guidance from the German Federal Bar Association on the use of AI applications: https://www.brak.de/
