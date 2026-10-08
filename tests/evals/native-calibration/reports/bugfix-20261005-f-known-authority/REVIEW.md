# F production known-authority regression: 2026-10-05

All four selected cases completed once through the real application, using all 15 imported documents and ten actual retrieved/packed passages per query. These are **known DEV cases**, previously observed repeatedly; the historical `authority-reserved` identifiers do not make this run a fresh evaluation.

Strict manual review finds **two supported answers and two complete safe abstentions**. No transport failure, timeout, grammar fallback or parser rejection occurred. Valid citation IDs alone did not determine these verdicts: each answer was checked against the supplied source text.

| Case                  | Result          | Exact evidence and reasoning                                                                                                                                 | Total / checked-stage time | Actual KV |
| --------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | --------- |
| authority-reserved-03 | Supported       | Current 84 EUR at 5:5; proposed 96 EUR and unvoted/nonbinding status at 6:6. No invented supersession.                                                       | 95.809 / 85.448 s          | q8_0      |
| authority-reserved-05 | Supported       | 1.5 minutes at 10:10 equals 90 seconds at 9:9. Both original values and local citations retained; no invented scope distinction.                             | 113.043 / 95.913 s         | f16       |
| authority-reserved-07 | Safe abstention | No deployed copy established; A(9)=8 and B(9)=9, each calculated and locally cited to 12:12/13:13.                                                           | 111.726 / 94.510 s         | f16       |
| authority-reserved-01 | Safe abstention | Nord 54 and Sued 57 both cover K9; exact 1:1/2:2 attribution. Withholds a definitive count and does not add, choose a minimum or invent partial populations. | 114.118 / 96.849 s         | f16       |

The even-count total-time median is **112.3845 s**. Startup took 44.720 s and indexing 10.185 s. The checked raw call emits the visible answer only after completion; apparent first-visible latency is therefore near total time, unlike ordinary token streaming.

## Configuration and limits

All four queries log `checked-answer-v1`, actual context 8,192, output budget 2,176, temperature 0 and explicit `repeatPenalty:false`. Each has one raw-generation start and a completed checking stage. GPU residency remained exclusive, with 14 chat GPU layers and a GPU embedder; reranking was off. KV adapted as shown above. There was no gold-source filtering, history, retry, multi-query, routing or whole-document fallback. Older evidence-assessment, marker-footer and alias experiments were off.

The worker SHA-256 is `8f3527f6b3707783d90a6a27e7f80948e713410b9774036a9de96d94541fe85c`; build-manifest SHA-256 is `beeb08a60b9b2b4bd0afc4d83026c6a97620d68d6136849a1ac909d6a6db6973`. Current sources matched the build at launch, and compiled fingerprints were unchanged after execution. Raw SHA-256: `854a5cfa024358deff93f202eea95b5480d846f548f02e8a99df1cae8d7e05c6`.

Together with the [two original cases](../bugfix-20261005-f-known-original/REVIEW.md), F has **five strict supported/safe results and one partial result across six known cases**. Original heldout-10 still turns undocumented supersession into a categorical no-replacement assertion. Do not report six clean passes or a general reliability guarantee.

F combines a compact prompt, deterministic arithmetic annotations, ordered check/answer output, a changed repetition setting and the live production budget. Earlier A-E2 diagnostics used a fixed 512-token budget and different compiled code. These results are not a sampler-only causal comparison. A separate, previously unrun 12-case corpus remained sealed throughout F. Its author also contributed to candidate design and evaluation, so it is not an independently authored blind holdout; the root implementer and independent answer reviewer had not opened its facts or answers.

The retained judgment is [manual.json](manual.json); [raw.json](raw.json) and [review.json](review.json) are local generated artifacts excluded from version control. Pre-change reconstruction hashes for all six actual supplied contexts are in `out/optimization-20261005/f-prompt-parity-before.json`; the post-currency-guard file confirms identical prompt/annotation bytes for all six. Only G's intentional evidence-precision system sentence changed. Reconstruction is not a claim that native prompt bytes were logged.
