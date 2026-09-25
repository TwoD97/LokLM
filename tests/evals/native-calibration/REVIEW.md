# Native calibration review

This run exercises the application with installed models and synthetic public test documents. Its answers are real inference results. Its 12 development and 12 document-disjoint held-out questions are a diagnostic sample, not a production accuracy estimate. Do not tune a rule on held-out answers and continue calling that run held out.

## Reproducible grading

After the native harness writes a raw report:

```powershell
pnpm.cmd exec tsx tests/evals/native-calibration/report.ts --raw tests/evals/native-calibration/reports/<run-id>/raw.json --manifest tests/evals/native-calibration/dev.json --out tests/evals/native-calibration/reports/<run-id>/mechanical-review.json
```

The command refuses to overwrite its output. Use `heldout.json` for a held-out run. Add `--manual <path-to-manual.json>` to incorporate independently reviewed answers into a new report. Manual JSON contains an array of entries:

```json
[
  {
    "caseId": "case-id",
    "repetition": 1,
    "verdict": "supported",
    "citationSupport": "supported",
    "unsupportedExtraClaims": [],
    "notes": "Checked the exact date and units against the supplied source passages."
  }
]
```

Verdicts are `supported`, `partial`, `unsupported`, `incorrect`, `false-refusal`, `safe-abstention`, or `unclear`. Citation support is `supported`, `unsupported`, `missing`, `not-applicable`, or `unclear`. Optional `citationCompleteness` is `complete`, `partial`, `none`, or `not-applicable`: it distinguishes a correct cited claim followed by an uncited claim from a marker pointing to a source that does not support it. Every answer requires manual review even when all mechanical checks pass.

## What to check in each answer

Read the question, the full answer, the reference answer, and the **actual supplied passages**, reconstructed from emitted citation events and imported document/chunk IDs. A correct fact from an unprovided source is not grounded in this request. The model's inline markers must belong to supplied passages. Supplied source chips alone do not establish that individual claims are supported.

1. Verify every requested entity, date, number, currency, and unit. Accept equivalent localized dates/decimal notation. Check negation and which year or table row each number describes.
2. Check calculations independently from the cited inputs. For a comparison, both input facts must survive packing and the answer must compare the intended quantities. Correct output from unsupported inputs does not pass grounding.
3. Check every additional factual claim. Record unsupported extras even when the required answer is correct. Repeating the right number in an unrelated or negated statement is not success.
4. For missing information, accept a clear limitation or supported partial context without inventing the requested fact. For conflicting sources, preserve the conflict; do not choose a definitive value without an explicit authority/supersession rule in evidence.
5. Distinguish retrieval/packing failure from generation failure. If the relevant source was not supplied, record that separately. If it was supplied but the model refused, mark `false-refusal`; if only part of a requested answer is correct, mark `partial`.
6. Verify the requested response language and source-marker placement. Language and citation issues are recorded separately from factual correctness.

The helper strips marker IDs before fact matching, preventing `[doc:72, chunk:3]` from satisfying a numerical answer of 72. Pattern matches, forbidden-pattern flags, and refusal cues are review aids. None proves semantic correctness or unsupportedness.

## Prompt hypotheses frozen before observing answers

| Hypothesis                                                                               | Diagnostic case                                                                       | What would establish the failure                                                                                                 |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| The ambiguity instruction encourages choosing one unsupported reading.                   | Two equally authoritative drafts give different deadlines.                            | Answer picks one definitive deadline despite both drafts being supplied and neither superseding the other.                       |
| Permission for arithmetic can encourage unnecessary adjustments or incorrect operations. | Exact table units, a simple sum, and a cross-year comparison.                         | Wrong operation/unit, distractor inputs, or unsupported assumptions despite adequate evidence.                                   |
| Relevant text without the requested fact can elicit invented completion.                 | A document mentions an entity but omits its phone number or another requested detail. | Definitive unsupported fact instead of a limitation. A generic refusal alone is insufficient if accompanied by an invented fact. |
| A small model may miss valid cross-language evidence.                                    | German question over English source and the reverse.                                  | Relevant fact is supplied but answer refuses, changes the fact, or uses the wrong response language.                             |
| Valid-looking source chips may hide unsupported inline claims.                           | Every answer.                                                                         | Inline marker points outside supplied evidence or its passage fails to support the claim.                                        |

No prompt change is part of this review. The installed `node-llama-cpp` version is 3.21.1. Its `LlamaChatSession` forwards omitted sampling options; `LlamaContext` currently defaults to temperature 0, minP 0, topK 40, and topP 0.95. An omitted seed resolves from wall-clock seconds. The application worker's chat path supplies repetition penalties and a zero thought-token budget, but no explicit temperature/seed override. Thus the initial baseline already uses the dependency's temperature-0 default. Adding explicit temperature 0 freezes configuration intent; it is not a distinct temperature treatment. Neither temperature 0 nor a fixed seed guarantees bit-identical GPU output across allocations, builds, or kernels.

## Timing and allocation

Keep requested context separate from the recorded model capacity after each query; an 8K request that resolves to 4K is a 4K result. Record GPU name/VRAM, loaded model hashes/quantization, actual GPU layers/total layers, code revision and dirty-source hashes, dependency version, corpus hashes, and settings. Partial layer offload is not full GPU residency.

Measure request-to-first-visible-token and request-to-final-event, including retrieval and model handoffs. Record startup and indexing separately. Report sample counts and per-case times. A later query is not automatically warm because embeddings can require a model handoff. The helper uses the conventional median for p50 (mean of the two central values for even samples), and nearest rank for p95. Both are descriptive; with 12 observations p95 is the maximum and does not establish a stable tail-latency distribution. Keep errors, timeouts, and cancellations visible rather than excluding their cost from a success-only average.

For a fair change comparison, use the same frozen corpus, models, resolved context, retrieval settings, and case order. Change one treatment at a time; run development before a single frozen held-out check. Compare paired case outcomes, not only averages.

## Bounded acceptance checks

- No hangs, OOM, empty successful answers, or fabricated citation IDs.
- No silently mismatched requested/resolved contexts in conclusions.
- No new critical date, numeric, unit, or unsupported-answer failures on fixed cases.
- Correct grounded answers and safe abstentions reported separately, so universal refusal cannot appear successful.
- Manual citation support and unsupported extra claims included alongside mechanical checks.
- State untested areas: scanned/mixed-layout PDFs, charts, large libraries, long conversations, and general user-document distribution.

If a development change helps only one narrow pattern, report that limitation. Small synthetic results are evidence for the tested failure mode, not a calibrated similarity threshold or proof of broad RAG quality.
