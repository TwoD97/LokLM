# T: targeted inventory gate still refuses an answer

**The one requested known-case gate did not fix S06.** It completed cleanly in **88.990 seconds**, but returned the **identical visible answer**: an insufficient-evidence lead followed by the correct complete inventory passages. It remains a strict partial/nonpass; a successful transport or schema parse is not a successful answer.

The question asks whether the two Ostel stock records contradict each other and requests their counts with times. Actual supplied **11:11** gives **12 at 08:00 UTC before deliveries/withdrawals**; **12:12** gives **17 at 18:00 UTC afterward** on the same date. These establish different observation times, so the differing counts can be compatible. T selects the correct two passages and displays their exact facts with correct local citations, but chooses `comparison/insufficient` and states that the supplied excerpts do not suffice to answer. It omits the requested relationship judgment. There is no retrieval or citation defect that explains this refusal.

T changed only two general instruction lines: they distinguish descriptive observations from governing-rule authority and reserve insufficient for a missing requested datum or relation after supported calculations. No schema/parser/source-ID/rendering/sampler/context/retrieval/output-budget change was made. The v8 schemas for 1/2/10/32 catalogs were byte-identical to the previously successful public S grammar compilations. The qualified prompt change was frozen before the new three-case fixture contents were released. That fresh corpus was not read or run by the executing agent for this gate.

All **18 source documents** remained eligible, with default expansion, no reference-source selection, an actual **8192-token/q4_0/14-GPU-layer** allocation, temperature 0, repeatPenalty:false and 2176 native output tokens. S06 also used q4_0, but one observation does not support a general latency or causal quality claim. T generated once with no retry, schema fallback, timeout or cancellation.

| Content-free measurement         |           T observation |
| -------------------------------- | ----------------------: |
| Total / first visible answer     | 88.990 / 88.989 seconds |
| Native execution                 |                78604 ms |
| Grammar / exact prompt-fit check |               4 / 30 ms |
| First / last native callback     |        24026 / 77395 ms |
| Input / output tokens            |              2591 / 108 |
| Response characters / callbacks  |               252 / 107 |
| Completion reason                |   stopGenerationTrigger |

Callbacks are internal response events, not visible streaming or exact prefill measurements. Startup was 42.565 seconds, indexing 10.291 seconds, and sampled peak GPU use 3446 MiB. The observer retained only bounded structural types/counts, not private check, raw envelope, source-list values, answer text or hidden segments. It took 0 ms, with zero errors, dropped rows or pending requests; settlement took 3 ms.

Freeze: local generated `out/optimization-20261005/t-production-freeze.json`, 2026-10-05T19:22:27.537Z. The underlying instruction source freeze was 2026-10-05T19:18:33.920Z. Build manifest SHA-256: `1498fc86875da5f27f01adfd6d205facc7a0840ee89a1769a005d4850bdd9de7`; worker SHA-256: `1afc9f5617eda7029a56602786205c66d2eb5de79755d9b214e054c01d21e376`; comparison helper SHA-256: `39cf44d8939f30fe38e2d0d883da80e6e6e4202aa15a340fe261e4262e925f7e`. Source/build correspondence and compiled bytes remained matched after exit.

The owned process exited 0, GPU was released immediately, and the remaining eleven known reasoning cases, four transfer controls and three fresh cases were held. None is counted as attempted here. [The S regression](../bugfix-20261005-s-known-reasoning/REVIEW.md) retains the original defect unchanged. This is known development evidence and does not establish a reliable automatic compatibility decision.

[manual.json](manual.json) records the nonpass. `raw.json`, `review.json`, `app.log` and `retrieval.log` are local generated artifacts. Raw SHA-256: `88faeff7736690a7482bb9de321c25c44593a24d633e91fad01c11af2fafd703`. Visible-answer equality with S06: **true**. No private reasoning was inspected or retained and no answer/source repair was applied.
