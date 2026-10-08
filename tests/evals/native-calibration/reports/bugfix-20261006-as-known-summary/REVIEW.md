# AS known-case aggregate: 10 strict passes, one nonpass, two unattempted

The declared 13-case coverage produced **11 completed attempts: 10 strict passes and one semantic nonpass**. The original heldout pair was not attempted after AB01's unsupported joint-applicability answer. No timeout, parser rejection or retry occurred in these AS groups.

All 11 answers completed within their prospective 300-second app cap. **Seven completed within 180 seconds; six both passed strict correctness and completed within 180.** These are different measures. The failed AB01 is among the seven fast completions, while correct AB02 took 180.305 seconds.

Runtime admission also remains separate: the initial gate's exact-Q8 contract **failed** for case ar-fresh-07, which used F16. The later eight observations passed a separately declared adaptive-allocation contract. This summary does not retroactively repair the old gate or describe all 11 as one uniformly compliant runtime experiment.

[Safe observations](observations.json) preserve all 11 exact validated finals and their group-specific source catalogs/order, closure pins and scalar metadata. [Manual reviews](manual.json) retain the unchanged original criteria and per-case judgments.

| Case        | Group     | Strict content/citation/format |  App time | Actual KV | Clean within 180 | Its runtime contract |
| ----------- | --------- | ------------------------------ | --------: | --------- | ---------------- | -------------------- |
| ar-fresh-01 | gate      | Pass                           | 181.940 s | Q8        | No               | Pass                 |
| ar-fresh-02 | gate      | Pass                           | 172.323 s | Q8        | Yes              | Pass                 |
| ar-fresh-07 | gate      | Pass                           | 127.055 s | F16       | Yes              | Fail: required Q8    |
| ar-fresh-03 | remaining | Pass                           | 220.217 s | Q8        | No               | Pass                 |
| ar-fresh-04 | remaining | Pass                           | 188.542 s | Q8        | No               | Pass                 |
| ar-fresh-05 | remaining | Pass                           | 152.334 s | F16       | Yes              | Pass                 |
| ar-fresh-06 | remaining | Pass                           | 178.920 s | F16       | Yes              | Pass                 |
| ar-fresh-08 | remaining | Pass                           | 133.739 s | F16       | Yes              | Pass                 |
| ab-fresh-01 | ab        | Applicability nonpass          | 141.428 s | F16       | Yes              | Pass                 |
| ab-fresh-02 | ab        | Pass                           | 180.305 s | F16       | No               | Pass                 |
| ab-fresh-03 | ab        | Pass                           | 155.420 s | Q8        | Yes              | Pass                 |
| heldout-10  | original  | Unattempted                    |         — | —         | —                | Unobserved           |
| heldout-06  | original  | Unattempted                    |         — | —         | —                | Unobserved           |

The one semantic nonpass is AB01. It correctly names North's 14 days and South's 19 days, uses the correct local references, and satisfies the one-short-sentence format. However, **“gelten beide Intervalle”** asserts that both conflicting same-scope intervals apply. The notes establish neither that joint applicability nor a governing choice. The missing South priority confirmation does not repair the assertion. This is distinct from a wrong numeric value, an invented single winner, a malformed citation or an operational failure.

The ten passes include the original AR failure cases 01/02/07, the remaining AR authority, arithmetic, unit and missing-input controls, plus AB's partial-amendment/nonapproval and actual/planned arithmetic cases. Each was checked against unchanged questions/strict keys and actual supplied passages, including every material extra claim, requested explanation, local reference and format condition. Gate content success remains separate from its runtime failure.

The three closed groups preserve their own declarations and denominators:

- [AS original known gate](../bugfix-20261006-as-regression-gate/REVIEW.md): content 3/3; clean within 180 2/3; exact-Q8 treatment false.
- [AS adaptive remaining five](../bugfix-20261006-as-adaptive-regression-remaining/REVIEW.md): strict 5/5; clean within 180 3/5; adaptive treatment true.
- [AS adaptive AB group](../bugfix-20261006-as-adaptive-regression-ab/REVIEW.md): strict 2/3; clean within 180 2/3; strict and within 180 1/3; adaptive treatment true.

All used frozen AS build `98ed3e0ec91bb9d5a8a05eff13c943fd6d2eea03334d6d8992bb66fed6c99075`, original full eligible corpora (20, 20 and eight documents), one attempt per declared case, zero retries and 300-second app caps. Evaluation explicitly set `rerank=false`, `multiQuery=false`, `routing=false`, `wholeDocFallback=true` and `CONTINUE_ERRORS=0`; these are not all production defaults. Actual restored KV varied between Q8 and F16, with 8192 context and 14 GPU layers in these observations. All observed v20/check+result, bounded 128/main, effective output allowance 2176 and compact JSON. The exact observed allocation and its own prospective requirement are retained per group. App elapsed, not native elapsed, determines within-180 status.

Matched frozen source/compiled/model/data/harness pins and clean capture/observer/process closure were verified separately for every group. These are historical closure facts. Production moved to a later candidate after AS collection; no assertion is made that the current workspace equals AS. No evaluation-side answer/source/key repair or original-pair retry occurred.

The [original AR sealed fresh result](../bugfix-20261006-ar-fresh-validation-summary/REVIEW.md) remains **strict 5/8**, clean within 180 5/8, and strict plus within 180 3/8. Its format partial, parser rejection and false refusal remain recorded with the original eight-case denominator and unattempted-only continuation boundary. All AS questions were already revealed known DEV. Successes here are regression evidence, not a fresh-generalization claim or broad reliability proof. Earlier AQ failures are unchanged. Different group starts and adaptive allocations do not support causal latency or precision claims.

The two original cases remain unattempted. This report grants no follow-on execution. It composes already-safe observations only and retains no hidden thoughts, private checks, raw envelopes, rejected prose, unrestricted logs or personal paths. Existing group reports, sealed fixtures and keys remain byte-identical.
