# F production known-original regression: 2026-10-05

This is a two-case **known DEV regression**, not a fresh held-out evaluation. Both cases were selected before execution, run once through the real application with all six corpus documents imported, and retained without retries. Generation used the actual retrieved and packed context; no reference-source filtering was used.

Strict result: **one supported answer and one partial answer**. Both primary decisions and numeric/date answers are correct, but that is not equivalent to every claim being supported.

| Case       | Strict result | Actual passage review                                                                                                                                                                                                        | Total / checked-stage time |
| ---------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| heldout-10 | Partial       | Correctly withholds a final deadline and gives both ISO dates with 3:6/4:7. However, “B did not replace A” converts missing documentation into a categorical historical claim. German wording also contains “ist feststeht.” | 114.350 / 103.658 s        |
| heldout-02 | Supported     | Correct 156 planned inspections in 2025, citing the actual table passage 2:5. Requested short English sentence and no extra claims.                                                                                          | 77.850 / 60.225 s          |

The even-count total-time median is **96.100 s**. The checked call completes before the final text is emitted, so first visible text is near total latency. This should not be compared with streamed first-token timing as if both measured the same user experience.

## Executed configuration and provenance

Both observations log `checked-answer-v1`, actual context 8,192, output budget 2,176, temperature 0, and explicit `repeatPenalty:false`; each has one raw-generation start, a completed checking stage, and no grammar-fallback log. Reranking, multi-query, routing, whole-document fallback, aliases, marker footers, and the older evidence assessor were off. Runtime context remained 8K with 14 GPU layers; KV changed from q8_0 on heldout-10 to q4_0 on heldout-02. Startup used f16. Adaptive memory choices are recorded, not treated as a fixed KV control.

The worker SHA-256 is `8f3527f6b3707783d90a6a27e7f80948e713410b9774036a9de96d94541fe85c`. Build-manifest SHA-256 is `beeb08a60b9b2b4bd0afc4d83026c6a97620d68d6136849a1ac909d6a6db6973`. The raw report confirms current sources matched the build at launch and recursive compiled fingerprints were unchanged after execution. The pre-run configuration snapshot is `out/optimization-20261005/f-production-freeze.json`.

F combines prompt changes, deterministic arithmetic annotations, a check-before-answer grammar, explicit no-repetition penalty, real retrieval, and the production output budget. Earlier A–E2 generation diagnostics used a fixed 512-token budget and a different compiled worker. This run cannot isolate a sampler-only or prompt-only effect.

The retained judgment is [manual.json](manual.json). [raw.json](raw.json) and [review.json](review.json) are local generated artifacts excluded from version control. Raw observations and source chunks remain authoritative; mechanical citation membership is not a semantic guarantee. A separate, previously unrun 12-case corpus remained sealed during this run. Its author also contributed to candidate design and evaluation, so it is not an independently authored blind holdout; the root implementer and independent answer reviewer had not opened its facts or answers.
