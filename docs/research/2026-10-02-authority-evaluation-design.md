# Authority, conflict and abstention evaluation — 2 October 2026

This evaluation is a small synthetic diagnostic for LokLM's actual local RAG path. It does not establish production accuracy, legal authority, calibrated confidence, or performance on arbitrary user documents. The old development, held-out and post-held-out conflict fixtures remain unchanged. The original held-out set has already informed development; it is not a fresh reserved test.

## Research basis

- **Separate rejection from useful synthesis.** RGB evaluates noise robustness, negative rejection, information integration and counterfactual robustness separately. A system that refuses every question would therefore not satisfy the overall task. Our small set pairs unresolved and missing-evidence cases with answerable controls. [RGB, Chen et al., AAAI 2024](https://arxiv.org/abs/2309.01431).
- **A difference is not automatically a contradiction.** ConflictBank distinguishes conflicts associated with misinformation, temporal changes and semantic differences. SituatedQA evaluates how temporal and geographical context changes a valid answer. We consequently include different scope/time and equivalent-unit controls rather than treating multiple numbers or dates as sufficient evidence of conflict. [ConflictBank, Su et al.](https://arxiv.org/abs/2408.12076), [SituatedQA, Zhang and Choi, EMNLP 2021](https://aclanthology.org/2021.emnlp-main.586/).
- **Judge the context actually available to the answerer.** Sufficient Context separates whether the supplied question/context pair can support an answer from whether a particular answer is correct. Its analysis also cautions that more abstention can reduce the number of correct answers. We record post-packing evidence availability separately from the final answer decision. A source present somewhere in the library is not necessarily present in the prompt. [Joren et al., ICLR 2025](https://arxiv.org/abs/2411.06037).
- **Correct facts and correct citations are different dimensions.** ALCE evaluates answer correctness separately from citation quality and distinguishes citation completeness from whether citations support claims. This motivates manual inspection of the exact cited passages and every added factual claim, beyond identifier membership and regex matching. [Gao et al., EMNLP 2023](https://aclanthology.org/2023.emnlp-main.398/).
- **Use strict answer review for unsupported extras.** FreshQA separates correctness under relaxed and strict evaluation and includes changing facts and false premises. We retain correct central facts but still fail an answer that invents approval, deployment, finality, or a supposedly missing value. [FreshLLMs, Vu et al.](https://arxiv.org/abs/2310.03214).

The exact local rule that an unapproved proposal cannot supersede an explicitly still-effective approved document is an application-specific fixture assumption, supplied in the documents themselves. It is not a universal authority hierarchy proved by these papers. File order, filename, upload time and a later issue date alone do not constitute an approval fact in this corpus.

## Frozen challenge design

There are 16 new cases: eight development and eight reserved. Each split has four English and four German questions, five answerable cases and three cases requiring abstention from a definitive requested fact. Each split has 15 short Markdown/text sources, including two fenced code listings. Different entities, facts, values and wording are used across the splits. The documents contain ordinary operational facts and revision information, not instructions to the model or gold answers disguised as instructions.

| Category                           | Cases per split | Required behavior                                                                           |
| ---------------------------------- | --------------: | ------------------------------------------------------------------------------------------- |
| Unresolved numerical contradiction |               1 | Preserve both incompatible results and the unresolved status.                               |
| Approved supersession              |               1 | Select the explicitly effective approved replacement and explain the earlier value.         |
| Newer unapproved proposal          |               1 | Preserve the still-effective approved rule; do not equate recency with authorization.       |
| Different scope/time               |               1 | Answer both scoped facts without inventing a contradiction.                                 |
| Equivalent units                   |               1 | Recognize agreement after a simple, valid unit conversion.                                  |
| Missing evidence                   |               1 | State that the requested fact is unavailable without inventing it.                          |
| Conflicting code behavior          |               1 | Evaluate both code paths and avoid asserting an unsupported deployed result.                |
| Corroborating agreement            |               1 | Answer the agreed facts; do not manufacture uncertainty merely because two documents exist. |

Development manifest: `tests/evals/native-calibration/authority-dev-20261002.json`. The independently authored reserved manifest, sources and 16-file SHA-256 lock were kept under ignored `out/optimization-20261002/reserved` until the candidate implementation, prompts, models and run settings were frozen. Only categories, counts, paths and a lock digest were shared before that point. Publishing the reserved corpus after freezing makes it reproducible; changing the implementation after reading its answers converts it to development evidence.

Publication followed the explicit E freeze at 10:48:56 UTC on 2 October 2026. The published `authority-reserved-20261002.json`, its15 sources and original lock retain all sealed bytes; canonical lock SHA-256 is `e18ae81aeeb0ff40b588c78824db44e9605b317ee50651a68c9d8e8d29008963`. A separate Git repository with `core.autocrlf=true` verified all 17 files through staging and checkout. LF attributes and Prettier exclusions are installed in the real repository. The local audit record is `out/optimization-20261002/reserved-publication-proof.json`; no shared Git index or fixture content was rewritten by the proof.

All cases require complete answers (`allowPartial: false`). Seven cases per split require two source identities; the missing-fact case requires no citation proving an absence. A quote of a value does not prove that the model selected the correct rule, and a quote of approval language does not prove that it applies to the right entity, scope or effective date.

## Grading and release decisions

For every observation, independently record four dimensions:

1. **Transport and status:** terminal completion, error/cancellation, partial output, timeout and channel disagreement. Nonempty partial text cannot become a successful answer.
2. **Evidence availability:** which actual chunks survived packing and whether they contain every necessary fact, scope and authority relationship. Required-document presence is a diagnostic only. Record sufficiency as sufficient, missing evidence, unresolved conflict or unclear.
3. **Decision and factual content:** correct answer versus justified abstention, false refusal, unsupported final choice, incorrect calculation or incomplete conflict explanation. Check every value, unit, condition, date and unsupported extra claim.
4. **Grounding:** whether each cited passage supports its attached claim, and whether every material claim has sufficient citations. Marker-shaped code or link literals are not citations.

Use the reference answers and regex checks as aids, followed by the actual supplied passages and final output. No LLM judge is used to certify its own candidate's answers. In an answerable case with missing packed evidence, a refusal may be locally appropriate but the end-to-end case still fails; report the retrieval/packing failure separately. Quoting both sides while refusing an answerable approved revision is a false refusal or partial response, not a passing conflict check.

The semantic reviews stored as `manual.json` are judgments by separate assistant agents reading the original passages and output, not human-expert review or self-grading by the local Qwen model under test; reviewer reliability is not calibrated and those judgments remain auditable interpretations.

Report five answerable cases and three abstention cases separately for each split. Retain every timeout/error and all unobserved case IDs. A blanket-refusal policy cannot earn answerable successes. The bounded gate is no hangs/OOM/invalid citation IDs, no new unsupported definitive selections, and no loss of supported answers on the fixed answerable controls. This is a case-based decision, not a statistical generalization from eight examples.

## Harness changes and limitations

The new split loader preserves the old lock and requires a separate reserved-corpus lock once published. The evaluator now uses the application's citation parser for inline-citation classification and includes actual supplied passages in its review output. It requires cited sources for unresolved conflicts as well as answerable comparisons. Semantic entailment remains a manual judgment.

The new browser stream collector accepts the authoritative terminal returned by `chat.stream`, deduplicates its matching push event, preserves `error.full_text` and citations, distinguishes cancellation, and records invocation failures or mismatched terminal channels. A cooperative timeout is followed by a bounded cancellation grace period; a non-settling invocation cannot silently hold the entire run. The original eight-case DEV baseline started before this collector replacement, so its transport limitations remain disclosed rather than rewriting its raw observations.

`LOKLM_CALIBRATION_QUESTION_TIMEOUT_MS` accepts an integer from 30000 to 600000 and defaults to the previous 180000 ms. Its value and `LOKLM_EVIDENCE_ASSESSMENT` are recorded in the run configuration. Request-to-first-visible-token, terminal time and invocation completion time remain separate; any extra assessment pass must be included in latency. A requested 8K window that resolves to 4K is reported as actual 4K. Later queries are not automatically called warm when they trigger model swaps.

Source order and duplication need separate controlled perturbations. The opt-in [native utility-worker probe](../../tests/bench/evidence-assessment.md) compares `[A,B]`, `[B,A]`, `[A,B,Acopy]` and `[B,A,Bcopy]` for two DEV pairs. Original source IDs stay fixed; the duplicate gets a distinct document/chunk ID with exactly identical text. The prepared payload contains the production helper's prompt/schema and the full supplied hits. This changes the actual assessment context directly, rather than relying on import-order tie breaks. The probe records structured output, timing, model capacity and hashes; it does not run retrieval or final-answer generation. Duplicate documents are not independent corroboration, and model relation labels still need semantic review. Perturbation results are development robustness evidence, never additional reserved successes.

No new corpus evaluates OCR, long PDFs, charts, broad web truth, large libraries, adversarial prompt injection or specialized professional reasoning. The tiny source size deliberately keeps this pass focused on evidence use, authority and abstention under the current 4 GB GPU path.
