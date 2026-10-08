# S: twelve known reasoning cases

**Eleven of twelve requested observations passed strict factual, completeness and citation review. Case 06 produced a false refusal.** All twelve ran once and completed within the unchanged 180-second deadline. There were no retries, timeouts, transport errors, schema fallbacks or continuations. This is a known development regression, not a fresh holdout or evidence that all reasoning errors are fixed.

| Case | Required result observed                                             | Strict judgment              |     Total |
| ---- | -------------------------------------------------------------------- | ---------------------------- | --------: |
| 01   | Both original deadlines; no documentary precedence                   | Pass                         |  86.354 s |
| 02   | Approved drill amendment; unchanged saw limit                        | Pass                         | 160.843 s |
| 03   | Equivalent volumes normalized to 2750 L                              | Pass                         |  88.407 s |
| 04   | 135 s versus 150 s; no governing source established                  | Pass                         | 101.983 s |
| 05   | Current 72 EUR; proposed 81 EUR nonbinding                           | Pass                         | 145.659 s |
| 06   | False insufficient-evidence outcome despite explicit different times | Partial — incorrect decision | 101.323 s |
| 07   | Run B 24 L and correct approval date                                 | Pass                         | 106.596 s |
| 08   | North 6 / south 7; deployment undocumented                           | Pass                         | 142.226 s |
| 09   | 31 + 34 = 65 with disjoint serial ranges                             | Pass                         | 148.605 s |
| 10   | Rate alone does not establish total volume                           | Pass                         |  85.760 s |
| 11   | 18 L / 3 min = 6 L/min                                               | Pass                         | 123.431 s |
| 12   | No electrical measurement in supplied table                          | Pass                         |  89.899 s |

The remaining defect is material. Case 06 asks whether two inventory records contradict each other and requests their counts and times. Both actual supplied sources are complete: **11:11** gives **12 at 08:00 UTC before deliveries/withdrawals**, and **12:12** gives **17 at 18:00 UTC afterward**. S selects those exact sources and displays every fact correctly, but chooses `insufficient` and explicitly says the supplied excerpts cannot answer. It fails to conclude that the different observation times are compatible. This is a semantic decision/false-refusal defect, independently confirmed by both peer reviewers; it is not a retrieval, citation or quotation-preservation failure. Valid sources and literal text cannot validate the model's relation classification. The failed observation remains unchanged; no prompt edit or follow-up call occurred inside this run.

The successful observations address prior concrete failures: 02 composes the approved drill amendment with the unchanged five-saw base provision and correctly attaches both source passages; 03 and 04 include the requested unit conversions; 07 distinguishes the document's approval date from the measured table value; 08 gives both code results with local supporting sources; 09 adds explicitly disjoint populations with both input ranges cited; and 11 supplies the requested rate calculation. Missing-fact cases 10 and 12 do not manufacture values. Case 01 preserves both deadlines without turning missing documentary replacement evidence into a categorical claim that no replacement event occurred.

Whole-passage display has a usability cost. Comparison answers reproduce headers and context, sometimes source text in a different language from the question. Case 12 adds accurate but unnecessary water/time conversions to an electrical-measurement absence answer. These are presentation/relevance limitations, retained separately from factual success. The ordinary answers attach program-generated citations to each coherent record; semantic support still required manual inspection of the actual supplied passages.

The frozen candidate uses `typed-comparison-v8`. Ordinary records choose actual source IDs before writing text. Comparison records choose one to four IDs from the same all-fed catalog, and the program displays complete original passages with canonical markers and supported arithmetic. No model-generated quotation is repaired or substituted. Full-source display rejects whole-answer overflow rather than truncating it. Its 32,000-character cap is independent of the ordinary generated-answer limit. This construction prevents quotation-copying failures but does not verify source relevance, claim entailment or outcome choice; case 06 demonstrates that limit directly.

All **18 documents** were eligible on every query, using default whole-document expansion, hybrid retrieval, no reranker/multiquery/routing and no reference-source selection. All questions used an actual **8192-token context with 14 GPU layers**, temperature 0, repeatPenalty:false and a 2176-token native output allowance. KV precision adapted between q4_0 and q8_0; startup f16 is not the query allocation.

| Case | Actual KV | Mode / outcome            | Native time | Input / output tokens |
| ---- | --------- | ------------------------- | ----------: | --------------------: |
| 01   | q4_0      | comparison / unresolved   |    75.664 s |            2342 / 108 |
| 02   | q4_0      | answered                  |   143.516 s |            2522 / 246 |
| 03   | q8_0      | comparison / compatible   |    71.156 s |            2323 / 105 |
| 04   | q8_0      | comparison / unresolved   |    84.767 s |            2602 / 122 |
| 05   | q8_0      | answered                  |   128.310 s |            2132 / 232 |
| 06   | q4_0      | comparison / insufficient |    84.451 s |            2550 / 113 |
| 07   | q8_0      | answered                  |    89.453 s |            2626 / 135 |
| 08   | q4_0      | answered                  |   125.156 s |            2186 / 212 |
| 09   | q4_0      | answered                  |   131.585 s |            2554 / 207 |
| 10   | q8_0      | comparison / insufficient |    68.784 s |             2342 / 97 |
| 11   | q4_0      | answered                  |   106.152 s |            2568 / 147 |
| 12   | q4_0      | comparison / insufficient |    72.912 s |             2293 / 99 |

Every native call ended with `stopGenerationTrigger`, not cancellation. First visible content was the parsed final answer, not the internal native callbacks. Those callbacks are not exact prefill boundaries. The conventional even-sample median request time is **104.2895 seconds**, the mean of the sixth and seventh sorted observations (101983 and 106596 ms). The range is **85.760–160.843 seconds**; the slowest case leaves about 19 seconds under the deadline. Startup took 42.372 seconds, indexing 11.219 seconds, and sampled peak GPU use was 3438 MiB. There is no isolated causal latency claim against prior candidates: schema/instructions, generated length and adaptive allocation differ.

The synthetic observer matched the exact v8 schema after validating identical ordered catalogs at all three enum paths. It forwarded original IPC unchanged and retained bounded structural metadata only, never private check/raw envelopes, hidden segments, answer text or source-list values. Accepted final answers remain in the normal transcript. No observer errors, drops or pending requests remained. All source/build fingerprints and compiled bytes stayed matched after process exit.

Declaration: local generated `out/optimization-20261005/s-known-regressions-declaration.json`, 2026-10-05T18:52:29.558Z. Build manifest SHA-256: `8bf154b72b78cea6ca9b936c8279efbb37bb304674b691d7dbd51e7e8d0457c1`. Worker SHA-256: `1afc9f5617eda7029a56602786205c66d2eb5de79755d9b214e054c01d21e376`. The owned native process exited 0, and GPU was released. The later planned three transfer-positive cases were held by the parent after the false-refusal finding and are **not observations in this report**. The separate successful [S transfer04 gate](../bugfix-20261005-s-known-transfer04/REVIEW.md) is also not part of this twelve-case denominator.

These fixtures were previously run and participated in development. Their original shared-author limitation remains; this run is not blind validation. The newly sealed follow-on corpus was not opened or run here. No fixture/gold edits were made based on these outputs.

[manual.json](manual.json) preserves each strict judgment. `raw.json`, `review.json`, `app.log` and `retrieval.log` are local generated artifacts. Raw SHA-256: `e34834b1109ab559ed757164fe4edde238a54076b372519b8575c02ea1bff887`. The bounded S06 review artifact contains only the visible question/answer, actual supplied passages and content-free diagnostics at `out/optimization-20261005/s06-independent-review.json`. All earlier S/R/Q failures remain preserved.
