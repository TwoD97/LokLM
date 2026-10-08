---
title: 'Ask AI about a PDF: a practical source-checking workflow'
description: 'Check PDF text, ask focused questions, verify citations and keep conflicting versions separate. A practical workflow with a reusable evidence note.'
lang: 'en'
translationKey: 'pdf-source-checking-workflow'
pubDate: 2026-10-07
tags: ['local-ai', 'pdf', 'research']
---

A useful PDF answer lets you return to the passage and decide whether the conclusion follows. That matters when preparing client work, reading a paper or looking up an internal procedure. A fluent summary alone does not complete that task.

This workflow uses LokLM as the document workspace, but the checking steps also work with other PDF assistants. It is a suggested method, not a benchmark or a guarantee that prompting will prevent errors. LokLM can still produce an overconfident conclusion when sources conflict.

## 1. Start with a small, identifiable document set

Choose one question and the documents needed for it. Keep filenames, versions and dates distinguishable: `Travel policy — approved March.pdf` is more useful than two files both called `final.pdf`. Keep a copy of the exact version you are reviewing.

Before importing confidential material, check the selected providers. In LokLM's bundled model path, processing runs on the device after model downloads. Optional Ollama connections can send content to the configured server. A server on another machine is a different data destination, even inside your organisation. The [privacy checklist](/en/blog/what-private-actually-means) explains what to inspect.

Start with a non-sensitive sample when evaluating a new installation. The [download requirements](/en#download) and [small-GPU guide](/en/blog/local-ai-4gb-vram) help you check whether the bundled models suit your computer.

## 2. Check that the PDF contains usable text

Open the PDF and try selecting and copying a sentence, including a number or a name. Inspect the pasted text. A scanned image may look clear while providing no useful text to a search index. OCR adds recognised text, but its output still needs checking. Adobe's [OCR documentation](https://helpx.adobe.com/ca/acrobat/desktop/create-documents/scan-documents-to-pdfs/recognize-text.html) describes both the searchable text layer and the need to review recognition accuracy.

In LokLM, wait until document indexing finishes before judging retrieval. Check any reported import or indexing errors. Then search for a distinctive phrase you can see in the original. If it is missing or garbled, investigate extraction before asking for a whole-document conclusion.

Tables deserve a separate check: copy one row and see whether its value still belongs to the correct column heading. Reading order, footnotes and decimal separators can change the meaning without making the text look obviously broken.

## 3. Ask a question that can be checked

State the document, topic and relevant scope. These are example prompts you can adapt:

| Your work                         | A useful first question                                                                                           | What to verify                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Independent professional          | “What deliverables does the signed project brief list for phase two? Cite each passage.”                          | Phase, signature/version and exclusions   |
| Student or researcher             | “What limitations do the authors state for this experiment? Keep their claims separate from your interpretation.” | Study population, method and limits       |
| Employee using internal documents | “What does the approved travel policy say about receipts for domestic trips?”                                     | Approval status, trip type and exceptions |

Follow up on one uncertain point at a time. A request such as “compare the two versions and cite each difference” makes the intended task clearer; it does not ensure that every difference will be found.

## 4. Check claims against the actual passages

Open the citation and read the surrounding paragraph, table heading and footnote. Check:

- Does the passage support the entire claim, including its number, unit and condition?
- Does it describe the same person, project, population or period?
- Is this a proposal, a reported observation or an approved instruction?
- Does an exception on the next page change the conclusion?

A real citation can accompany an unsupported claim. Citation quality is evaluated separately from answer correctness in the [ALCE research](https://aclanthology.org/2023.emnlp-main.398/). A clickable reference is an inspection aid, not a correctness certificate.

If the displayed source and your current original differ, stop and establish which version was indexed. A highlighted fragment is a starting point for reading; it does not identify every qualification the answer needs.

## 5. Keep conflicting sources visible

Consider this **invented example**, not a LokLM test result:

| Document                       | What it says                    | What it establishes                    |
| ------------------------------ | ------------------------------- | -------------------------------------- |
| Approved workshop plan, 3 June | “The session lasts 45 minutes.” | The approved plan contains 45 minutes. |
| Draft agenda, 10 June          | “The session lasts 60 minutes.” | The later draft proposes 60 minutes.   |

The later date alone does not establish that the draft replaced the approved plan. A useful review records both statements and asks for the approval or revision record needed to resolve them. Do not let a confident “the session is now 60 minutes” settle that missing step.

LokLM's current RAG evaluation still identifies conflicting-source reasoning as a limitation. Even an instruction to list disagreements may miss one or assign authority incorrectly. For a consequential decision, inspect both originals and seek the missing confirmation from the responsible person.

Similarly, “I found no passage” is a statement about a search result. It does not establish that no such rule exists anywhere in the document set.

## 6. Save a short evidence note

Use this template in a note or your working document. Keep source wording distinct from your conclusion:

```text
Question and scope:
Document title, version/date and page:
Relevant source wording:
My checked conclusion:
Exceptions or conflicting passages:
Still to verify, and with whom:
```

Record the original's printed page label if it differs from the PDF viewer's page number. Keep unresolved points visible when passing the note to someone else. Share only material you are authorised to share.

For the mechanics behind document search, read the [LokLM architecture](/en/architecture). For the distinction between evidence and data handling, see [understanding citations](/en/blog/citations-as-privacy).

_Product details were checked against the [current development source](https://github.com/TwoD97/LokLM) on 7 October 2026. An installed release, including 0.7.0, may have different controls or behaviour; this guide does not announce a new release._
