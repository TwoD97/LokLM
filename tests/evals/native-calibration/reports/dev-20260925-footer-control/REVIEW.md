# Source-marker footer control: independent manual review

Reviewed all four completed real answers against the imported chunk text and per-query supplied citation events in `raw.json`. All are first observations (`repetition: 0`); this run contains no warm repeats. This is a targeted development diagnostic, not a held-out or general accuracy estimate.

| Case   | Facts, language, and requested format                                 | Exact-passage attribution                                                                                                                     | Verdict                 |
| ------ | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| DEV-06 | Correct EUR 53,780 minus EUR 48,260 = EUR 5,520; one English sentence | Cites 1:1 and 1:2. Passage 1:1 is the 2025 introduction; 1:2 supports only recorded 2025 revenue. Supplied planned-2026 table 2:5 is omitted. | Unsupported attribution |
| DEV-03 | Correct ISO approval date 2026-03-09; one short English sentence      | Supplied approval passage 2:4 supports the claim.                                                                                             | Supported               |
| DEV-07 | Correct identifier MSX-417; one short German sentence                 | Supplied draft A passage 3:6 supports the claim.                                                                                              | Supported               |
| DEV-11 | Correct return value 0; one short German sentence                     | Supplied complete function passage 5:8 supports the lower clamp and final result.                                                             | Supported               |

Three of four answers are fully supported. All four contain the requested correct facts, but correct arithmetic does not excuse the comparison's wrong-passage citations. All required factual passages were supplied; the comparison failure occurs after retrieval. No unsupported extra facts, incorrect response languages, timeouts, or stream error events were found in these four observations. No absent-fact or conflict case was tested in this arm.

The requested and resolved context is 8192 tokens throughout, with 14/33 model layers on the GPU. Runtime KV choice is q8_0 for DEV-06 and f16 for DEV-03/07/11; startup used q4_0. Preserve these adaptive choices when comparing the later footer arm. Identical settings alone do not establish identical native allocation or deterministic answers.

First-visible times are 35.995, 46.824, 44.849, and 42.482 seconds in case order; their conventional even-sample median is 43.6655 seconds. Final-event times are 76.180, 63.089, 57.389, and 55.930 seconds, median 60.239 seconds. These are descriptive four-observation timings including model handoffs, with no footer-effect conclusion yet.

`manual.json` records each verdict. The original raw answers, emitted source set, normalized terminal citations, and exact chunk text remain unchanged.
