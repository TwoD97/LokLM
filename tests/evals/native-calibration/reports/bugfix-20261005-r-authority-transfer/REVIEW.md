# R: four-case authority transfer challenge

**Three of four first observations passed strict factual, completeness and citation review. One produced no usable answer because the comparison quotation contract failed.** All four requested cases ran once with the same frozen R build. There were no timeouts, repeats, follow-up inference calls, source edits or continuations. This small synthetic set does not demonstrate general RAG reliability or resolve the comparison-copying limitation.

| Case | Required behavior                                                        | Strict result                                               | Total time |
| ---- | ------------------------------------------------------------------------ | ----------------------------------------------------------- | ---------: |
| 01   | Apply approved mixer amendment; retain unchanged microphone limit        | Pass: 6 mixers / 8 microphones; exact 1:1 + 2:2 support     |   159.428s |
| 02   | Distinguish approval from future effect                                  | Pass: 12 workdays now; 9 from 2042-09-01; exact 3:3 + 4:4   |   168.957s |
| 03   | Retain current badge deposit over an unapproved proposal                 | Pass: 28 EUR current;41 EUR not authorized; exact 5:5 + 6:6 |   151.424s |
| 04   | Present 420 N / 460 N same-scope alternatives without inventing priority | Failure: quote_missing; no completed answer                 |   145.863s |

Both evaluators inspected the actual supplied passages, not just reference regexes or source membership. In 01, adding the amendment's four-unit increase to the old two-unit mixer limit is a valid derivation; the unchanged eight microphones remain supported by the base policy. Its repeated bare source labels and verbose arithmetic are presentation defects, not factual failures. In 02, “Arbeittagen” is a spelling error; the current 12 / new 9/effective-date distinction is correct. In 03, the working paper explicitly states that no approving vote occurred and that it gives no authority to change the deposit, so the answer's negative authority statement is supported rather than inferred from mere documentary absence.

The failure in 04 is concrete. Both relevant 7:7 and 8:8 passages were supplied. The evidence-only observer retained a 198-codepoint string containing invented serialized `sources`/`text` metadata and an ellipsis joining the 420 N and 460 N statements. Its second 153-codepoint string concatenates/reorders/repeats date and temperature text before a real no-precedence clause. Neither is a contiguous source quotation under the permitted whitespace-only normalization. These are not 200-character overflow failures. The strict resolver correctly rejected them; no quote unwrapping, word rewriting, citation retargeting or hidden fallback was attempted. Correct rejection is still a user-visible failure to answer the requested comparison. The rejected check, raw envelope and final-answer text were not retained, so no final semantic outcome is inferred.

R logs confirm `typed-comparison-v7` for every query, ordinary `answered` completion for 01–03, and no parsed completion for 04. Ordinary records use a native enum of **all actual supplied passage IDs**, then text; canonical per-record citations are generated programmatically. This guarantees accepted membership/placement, not semantic support. Comparison records still use uniquely anchored exact quotations; 04 exposes the remaining copying limitation. All 12 documents were eligible, with default small-document expansion, hybrid retrieval and no reference-source filtering. Ten passages were actually supplied per query.

All calls used 8192 context tokens, 2176 output allowance, temperature 0, repeatPenalty: false and the fixed 180-second per-question deadline. Runtime allocation was 8K/q8_0/14 GPU layers for 01–03 and 8K/f16/14 GPU layers for 04. The automatic KV change is a timing confound, not a manually altered treatment.

| Case | Native time | Input/output tokens | Completion            | Observer work |
| ---- | ----------: | ------------------: | --------------------- | ------------: |
| 01   |    148949ms |            2166/270 | stopGenerationTrigger |           0ms |
| 02   |    151616ms |            2382/272 | stopGenerationTrigger |           0ms |
| 03   |    134440ms |            2172/243 | stopGenerationTrigger |           0ms |
| 04   |    128678ms |            2366/238 | stopGenerationTrigger |           0ms |

Across all four requests, the conventional median is 155.426 seconds (mean of 151.424 and 159.428); successful-answer median is 159.428 seconds. The range is 145.863–168.957 seconds. Internal native callbacks are not visible streaming or an exact prefill boundary. Startup took 41.374 seconds and indexing 10.133 seconds; sampled peak GPU use was 3453 MiB. Latency remains substantial and 02 had only about 11 seconds of margin under the deadline.

The observer was explicitly enabled in the isolated synthetic profile, matched only the declared checked schema after validating/normalizing its variable ID enum, and preserved original IPC. All four captures report zero observer errors, dropped rows and pending requests. It retains bounded evidence strings and structural metadata only, not check/raw JSON, source-list values, ordinary answer text or hidden segments. Accepted final answers remain in the normal transcript. Its no-model forwarding probe and grammar compilation for 1/2/10/32-source catalogs passed before this run.

**Evaluation provenance:** the GPU agent authored and sealed these four questions and twelve source-disjoint documents without model runs. That agent also participated in implementation and later independently graded the answers; this is not an independently blind holdout. Contents were withheld until Q's proposed/applied source contract was frozen, then published before R's source freeze. They were previously unrun when this R challenge began. No claims of broader independence or causal accuracy gains are warranted. Manifest and all source bytes were verified against the original seal before launch and remained unchanged.

Declaration: local generated `out/optimization-20261005/r-authority-transfer-declaration.json`, 2026-10-05T18:17:49.719Z. The requested denominator was 4 and all 4 were observed. Manifest fixture SHA-256: `4b6ba07fdea36ed1d92e20128f54324533e0417f356c87135b70a33dedbc737d`; original seal SHA-256: `f991fa11cfcea10a1bac631f4d474371ec2261b87e3db1c4750a23acd4708cb8`.

Production build manifest SHA-256: `eb0019cf60cea2d8a477914c5a3aae4cdbedbf2a7194fe5d8475e95dd44ac0ce`; worker SHA-256: `5a5539b78546d42ac1c26b58fc845d44f7eed72ea610754f21f5f09a089ea067`. Compiled bytes and source/build correspondence matched after exit. The owned process exited 1 because 04 failed; GPU was released immediately. No further native call is included here.

[manual.json](manual.json) records individual strict judgments. `raw.json`, `review.json`, `app.log` and `retrieval.log` are local generated artifacts. Raw SHA-256: `42d92f0a1d1a166ab48e438ec933db6b51778e8a91840950194d501efc5ee1ea`. Evidence-only failure classification and content-free metrics are preserved under `out/optimization-20261005/r-transfer04-evidence-classification.json` and `r-transfer-metrics.json`. Earlier failed gates and the separate successful known R J02 observation remain unchanged.
