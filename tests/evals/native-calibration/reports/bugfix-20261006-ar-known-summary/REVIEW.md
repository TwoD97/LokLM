# AR known-case correctness: 13/13; within180: 12/13

**All13 known cases produced validated answers that independently pass their unchanged original semantic, citation and format criteria. Twelve completed within180 seconds; isolated reasoning09 completed in184.894 seconds.** All13 completed within their prospectively declared300-second windows. The failed AQ180 gate and its separate completion300 parser rejection are preserved unchanged.

This is a grouped collection on frozen AR, not a fresh benchmark and not a replacement score for AQ. [Safe observations](observations.json) retain exact final answers, source mappings, timing and group provenance. [Manual review](manual.json) preserves every per-case judgment. No older candidate's pass is substituted for a current observation.

| Requested | Attempted | Validated finals | Strict content/citation/format passes | Within300 | Within180 | Above180 | Parser rejection | Timeout | Unobserved |
| --------: | --------: | ---------------: | ------------------------------------: | --------: | --------: | -------: | ---------------: | ------: | ---------: |
|        13 |        13 |               13 |                                    13 |        13 |        12 |        1 |                0 |       0 |          0 |

## Individual results in declared order

| Case                  | Original-criteria result | App seconds | Native seconds | Within180 |
| --------------------- | ------------------------ | ----------: | -------------: | --------- |
| reasoning-reserved-09 | Pass                     |     184.894 |        174.196 | No        |
| ab-fresh-01           | Pass                     |     128.960 |        117.958 | Yes       |
| ab-fresh-02           | Pass                     |     169.497 |        151.863 | Yes       |
| ab-fresh-03           | Pass                     |     144.655 |        127.520 | Yes       |
| heldout-10            | Pass                     |     141.325 |        130.821 | Yes       |
| heldout-06            | Pass                     |     168.172 |        150.789 | Yes       |
| reasoning-reserved-02 | Pass                     |     147.962 |        137.218 | Yes       |
| reasoning-reserved-05 | Pass                     |     146.454 |        128.966 | Yes       |
| reasoning-reserved-06 | Pass                     |     173.770 |        155.857 | Yes       |
| reasoning-reserved-11 | Pass                     |     143.979 |        126.350 | Yes       |
| reasoning-reserved-12 | Pass                     |     143.307 |        126.323 | Yes       |
| authority-transfer-01 | Pass                     |     142.333 |        131.039 | Yes       |
| authority-transfer-04 | Pass                     |     132.361 |        114.932 | Yes       |

The original questions and criteria remain authoritative: complete requested values/decisions, all visible claims supported by actual fed sources, local attribution and explicit format requirements. AB02's original explicit-nonapproval requirement is retained; its historical AM omission has not been relabeled. Original heldout10 and AB01 pass the established compact framed-sentence interpretation, with English original quotations noted as presentation tradeoffs. No one-sentence or extra-authority explanation rule is imported into unrelated questions. Full-passage transfer04 presentation is longer but satisfies its explicit comparison/justification request.

## Group boundaries and provenance

The isolated [reasoning09](../bugfix-20261006-ar-reasoning09-completion300/REVIEW.md) was completed and reviewed first. Root then prospectively accepted a separate300-second correctness protocol for the remaining12: [AB3](../bugfix-20261006-ar-completion300-ab/REVIEW.md), [original2](../bugfix-20261006-ar-completion300-original/REVIEW.md), [reasoning5](../bugfix-20261006-ar-completion300-reasoning/REVIEW.md), [transfer2](../bugfix-20261006-ar-completion300-transfer/REVIEW.md). Every group closed with matched pins and clean process/observer disposal before the next explicit grant. Reasoning09 was not repeated inside this coverage protocol.

All share build manifest `c238f16db7574e4638d435a4d7191d47abba20c5670fd54bb1de29f2c255b0ea`, with421 source/112 compiled inputs verified plus model, corpus and harness pins. Every postverification records source/build match, no changed paths, verified cleanup and completed request. No owned native/Playwright processes or capture artifacts remained. Group-level `safeToContinue=false` encoded explicit review boundaries rather than failed cleanup. Exact raw/declaration/postverification and public report hashes are preserved in the safe aggregate.

All sources in each original corpus were eligible: reasoning18 documents, AB8, original6, transfer12. Runtime used explicit evaluation overrides rerank=false, multiQuery=false, routing=false, wholeDocFallback=true; these are not all production defaults. One attempt per case, no retry, gold source filtering or evaluation-side repair occurred. Isolated09 had CONTINUE_ERRORS=true; the later four groups used false. No AR request error occurred. The fixed v19 bounded128/compact/main route,8192 context,2176 output cap and observedQ8/14-layer allocations are recorded per case. Private check text and thoughts are not retained.

## Correctness is separate from timing and generalization

The300-second timer is a prospective calibration collection choice, not a changed production answer deadline. App elapsed time includes retrieval, preparation and model handoff; native timings are only subsets. The184.894-second reasoning09 answer is a strict content pass and a miss of the180-second performance threshold. Do not remove handoff cost, change the denominator or describe this as13/13 within180.

Each group starts in a new isolated profile. Reasoning09 was first rather than following02 as in AQ, and subsequent groups have different request positions from earlier runs. These differences prevent causal latency claims from cross-run comparisons. No warmups or reordered repeats were used to equalize them. The narrowest below180 margin here is reasoning06 at6.230 seconds, not a performance guarantee.

The [original AQ180 result](../bugfix-20261006-aq-known-summary/REVIEW.md) remains13 requested,5 attempted,4 strict completed,1 timeout and8 unobserved. The separate [AQ300 rejection](../bugfix-20261006-aq-reasoning09-completion300/REVIEW.md) still has no gradeable final. AR's accepted complete-label forms and current fixed shape counts do not reveal the exact discarded AQ text or uniquely prove the prior rejection's causal syntax.

All13 cases were repeatedly used in development. This collection establishes observed current behavior on those known cases, not blanket reliability or independent unseen transfer. No new facts, sources or keys were authored during it. Any future fresh protocol needs its own frozen candidate/model/harness/protocol and explicit authorship/execution grants.

Raw/log/declaration artifacts are local generated files; tracked review/manual/observations preserve validated finals and fixed metadata. No hidden thought, private check, raw generation envelope or discarded prose was inspected. This aggregation made no model calls and changed no production, harness, fixtures or original criteria.
