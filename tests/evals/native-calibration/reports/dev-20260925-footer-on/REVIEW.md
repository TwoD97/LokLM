# Source-marker footer arm: independent paired review

Reviewed all four completed real answers against the actual supplied chunk text and citation events. All four are fully supported: DEV-06 cites both exact revenue tables (1:2 and 2:5), DEV-03 cites the approval passage (2:4), DEV-07 cites draft A's identifier (3:6), and DEV-11 cites the complete function returning 0 (5:8). Dates, amounts, currency, identifier, code result, requested EN/DE language, and one-sentence format are correct. No unsupported extra facts were found.

| Case   | Control                                                             | Footers on                                    | First visible, control / on | Final event, control / on |
| ------ | ------------------------------------------------------------------- | --------------------------------------------- | --------------------------- | ------------------------- |
| DEV-06 | Correct arithmetic, wrong planned-revenue attribution (1:1 and 1:2) | Correct arithmetic and exact tables 1:2 + 2:5 | 35.995 / 35.057 s           | 76.180 / 71.453 s         |
| DEV-03 | Supported ISO date, 2:4                                             | Identical supported answer                    | 46.824 / 41.590 s           | 63.089 / 57.414 s         |
| DEV-07 | Supported identifier, 3:6                                           | Identical supported answer                    | 44.849 / 43.943 s           | 57.389 / 57.823 s         |
| DEV-11 | Supported code result, 5:8                                          | Identical supported answer                    | 42.482 / 44.999 s           | 55.930 / 58.245 s         |

The four-observation manual result changes from three fully supported answers in control to four with footers. The comparison improvement is an observed result on a targeted development case, not proof of general attribution accuracy or isolated causal benefit. There are no repeated observations, absent-fact questions, or conflict questions in this pair. Subsequent conflict and remaining-development reviews retain the opt-in default; see `../dev-20260925-footer-coverage/REVIEW.md` for the combined recommendation and limitations.

Both arms use the same recorded source/build hashes, fixture manifest hash, model hashes, imported chunk text, query order, and supplied passage order. No source was lost from packing in these four pairs. Both resolve to 8192 tokens and 14/33 GPU layers. However, DEV-06 uses q8_0 KV in control and f16 with footers; later queries use f16 in both. Runtime resource availability and native output variation remain confounds. The footer flag is the only intentional configuration difference, and remains off by default during evaluation.

Conventional even-sample medians: first visible 43.6655 s control versus 42.7665 s on; final event 60.239 s versus 58.034 s. Two final-event observations improve and two worsen. Do not attribute these small-sample timing differences solely to the footer. No query timeouts or stream errors were observed in either arm.

`manual.json` holds case-level judgments; `mechanical-review.json` is an independent mechanical aid and cannot prove semantic support. Raw outputs remain unchanged. The control review is in `../dev-20260925-footer-control/REVIEW.md`.
