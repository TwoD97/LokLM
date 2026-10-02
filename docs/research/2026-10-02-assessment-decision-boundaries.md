# Decision boundaries for the optional evidence assessment

The assessment should remain off by default until the real application demonstrates a useful tradeoff. The latest source-unit prototype preserves the correct relationship across eight order/duplicate variants of two questions, but this does not establish broader answer quality, full-context coverage, or acceptable added latency. Earlier representations and their failures remain part of the evidence below.

## What the current branch actually changes

The current V3 representation has exactly three relationships: `compatible`, `unresolved`, and `insufficient`. Only a parsed `unresolved` judgment replaces ordinary generation with an introduction and intact, cited source windows. `compatible` and `insufficient` proceed to the original answer generator with its original packed context. A false negative can therefore pass a real contradiction through to the same generator that previously invented supersession.

Historical Candidate B also emitted `resolved` and a claimed authority rationale; that representation is no longer live. Its wrong `resolved` record remains a real assessment error, but the historical application path also continued ordinary generation for that label, so the probe did not itself observe a wrong final answer.

A correct unresolved classification can prevent a subsequent unsupported definitive choice because code renders only the selected source spans. That benefit depends on the selected spans containing the competing facts and required qualifiers. A false positive can suppress an answerable approved rule, equivalent units, differently scoped facts, or agreement. A parse failure becomes an explicit request error; it is safe from fabricated facts but still a usability failure. No source-membership, JSON, unit-ID, or exact-quote check establishes semantic contradiction or approval.

The prototype applies only where its planner accepts the complete packed context, currently standalone questions over 2–12 original passages with at least two documents. History/summary paths and rejected plans bypass it. Every claimed benefit must include actual planned/started/completed coverage; an enabled flag alone proves nothing.

## Measured evidence and limits

- Candidate A completed three fixed-context unresolved controls. All three were malformed and omitted the needed values; five remaining plans were unobserved.
- Candidate B completed two explicitly selected controls, with six intentionally unrequested. Both parsed. DEV01 selected the correct differing counts and unresolved relation; its spans omitted approval qualifiers. DEV03 quoted true evidence but incorrectly made an unapproved proposal override the active certificate by citing the sentence denying approval.
- Candidate B assessment cost alone was 41.47 and 63.23 seconds on the 8K, 14/33-GPU-layer path. These are two-source utility calls, not measured ten-passage application latency. An intercepted unresolved answer might save a later generation; a non-intercepted answer pays the assessment plus ordinary generation. Neither net effect can be inferred by adding or subtracting independent runs as though caches, context and swaps were identical.

The standalone probe generates no final answer. It therefore cannot demonstrate a reduction in unsupported final decisions or quantify false refusals in the application. It also cannot establish order/duplicate robustness when only A-B controls were requested.

Later representations remain separate experiments; no parser change repairs an old result retroactively:

| Prototype                                         |   Completed observations | Original parser | Independent finding                                                                                                                          | Median assessment only |
| ------------------------------------------------- | -----------------------: | --------------: | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------: |
| V2 numbered units                                 |               2 selected |             0/2 | Correct relation labels, invalid noncontiguous selections; active capacity omitted from one selected span                                    |                31.42 s |
| V4 whole-passage booleans                         | 8 variants / 2 questions |             4/8 | Zero usable unresolved comparisons in four variants; opposing sources omitted or replaced with identical duplicates                          |                18.13 s |
| V5 relation first plus IDs                        | 8 variants / 2 questions |             8/8 | All four unresolved variants work, but three of four answerable variants become false unresolved comparisons                                 |                15.19 s |
| V3 source units with intact first-to-last windows | 8 variants / 2 questions |             8/8 | All relation labels correct; four usable unresolved displays; two compatible controls omit the proposed capacity from their selected display |                30.69 s |

V5 also exposes duplicate sensitivity: A-B and B-A both falsely label the approved-versus-proposed control unresolved, while adding an A copy changes it to compatible. Its better parser rate and speed do not compensate for the new false-refusal risk. These diagnostic variants do not provide eight independent quality examples. The independent raw/parser/manual records are retained under their respective `out/optimization-20261002` run directories.

V3 was run after V5 using its previously frozen prototype. It preserves both competing counts and missing approval across all four unresolved variants, without falsely intercepting any of the four authorization controls. In A-B and A-B-Acopy, its proposal span omits proposed 18 and the explicit lack of an approved replacement; the active approved capacity remains visible. This is incomplete evidence selection, though compatible continues ordinary generation from the full original context. Those observations justified an experimental end-to-end run, not a default-on claim. Its median assessment-only cost was 30.6885 seconds plus a separately recorded 41.426-second cold load. At that point, ten-passage application cost and other categories were still unmeasured.

## Full application evidence from D

The subsequent full DEV run, `authority-20261002-assessed-d-dev`, answers the coverage and latency questions for this small corpus. Assessment planned, started and completed in all eight requests, each with ten passages from ten documents. Independent assistant-agent review finds four supported answerable responses, one safe complete abstention, two partial responses and one false refusal. The approved-versus-proposed control that passed the two-source probe fails in the real application: true quoted spans are presented as unresolved even though the current authorization is explicit. Another answer adds seven irrelevant excerpts, and the code case quotes functions without evaluating the requested calls.

The resulting default decision is **off**. Median total latency is 162.956 seconds; median first visible text is 112.1975 seconds. The assessment alone has a median duration of 73.844 seconds. Four cases exceed the historical 180-second cutoff, though all finish under the recorded 300-second limit. Actual quote provenance is preserved, but that does not offset the false refusal, relevance regression and additional cost. D also changes final-answer instructions; a same-build guard-off control is needed before attributing improved ordinary answers to the assessment. See the retained [D run review](../../tests/evals/native-calibration/reports/authority-20261002-assessed-d-dev/REVIEW.md).

The attempted D guard-off control is additionally confounded by automatic profile choice: the assessment run records LITE throughout, while the control's first completed query records FULL before and after generation. D maps those profiles to standard versus thorough answer-depth instructions despite the same 4B model and actual 8K context. This is an implementation-based inference from recorded profiles; final system-prompt strings were not captured. KV precision also varies. The control remains an observed answer result, but must not be presented as a clean assessment-only causal comparison.

## End-to-end development gate before reservation is opened

Use the same compiled snapshot and settings for the original four conflict cases and all eight new DEV cases, then compare prompt-only and assessed paths where practical. This gives seven answerable controls and five justified-abstention controls; never collapse them into an undifferentiated accuracy score.

1. Retain every selected request, including errors, cancellation and incomplete output. Record the actual post-packing passages, guard coverage, terminal status and exact attached citations.
2. Preserve the correct current/final facts in all seven answerable controls. A new false refusal, invented contradiction, reversed approval, or missing required comparison is a regression even if quotes are copied perfectly.
3. On the five abstention controls, preserve both incompatible values or code results where requested, explain the unresolved status, and avoid unsupported definitive choices. Quoting code without evaluating the requested call can remain incomplete.
4. Demonstrate a concrete reduction in the original unsupported authority/citation failures. Valid JSON or a correct classifier label alone does not satisfy this gate. No gain is established if the same ordinary generator still produces the same unsupported claims after a non-unresolved assessment.
5. Measure request-to-visible-output and terminal latency through the actual application, including extra assessment and model swaps. Report a parse/error rate and the added cost on answerable cases alongside any quality improvement. A large default latency cost without a demonstrated quality benefit fails the balanced speed/quality objective.

This is a small case-based gate, not a calibrated probability threshold. Keep the reserved eight-case corpus sealed until implementation, prompts, model, context, feature flags and timeout policy are fixed. Later changes prompted by reserved results must be labeled development work and cannot retain the original reserved claim.

## Prepared prompt-only sequence

The current calibration harness accepts one split per invocation. It does not combine splits or reuse an application process between them. Merging both document pools would change distractors and retrieval/packing, so it is unsuitable for direct comparison to the separate baselines. Reusing one process with separate workspaces would still incur indexing-to-chat swaps and save mainly one cold startup; avoid a lifecycle refactor for that small saving.

The prepared, unexecuted PowerShell sequence is `out/optimization-20261002/run-prompt-only-b.ps1`. With an exclusive native slot and the frozen B build:

```powershell
pwsh -NoProfile -File out/optimization-20261002/run-prompt-only-b.ps1
```

It runs old four then DEV eight with two isolated temporary vaults, one worker, no retries, no warm repeats, assessment off, 8192 context and default resource settings. It builds nothing and stops on a failed calibration invocation. Output logs and native raw reports use distinct new run IDs. The suggested 300-second per-question limit is recorded and differs from the 180-second original baseline: report any answer exceeding 180 seconds separately, and retain the original timeout rather than reclassifying it. Pass `-QuestionTimeoutMs 180000` to keep the original cutoff exactly; the existing harness will stop the remaining sequence on a timeout, leaving later cases unobserved.
