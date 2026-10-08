# I: initial known twelve-case run, stopped at the fixed deadline

The run requested all twelve known challenge questions. **Four were attempted: two strict passes, one citation partial and one timeout. Cases 05–12 were not observed in this run.** A later continuation of only those unattempted cases is recorded separately; it does not replace the timeout or change this original denominator.

The presealed challenge is now known DEV. It was authored by an agent who also participated in candidate design; neither this run nor the earlier challenge was an independently authored blind holdout. All 18 documents were imported and actual production retrieval supplied the evidence. No gold-source selection or hidden retry was used.

## Frozen candidate and configuration

I groups the v3 protocol (no `established` quotation-only branch), bounded enclosing source-paragraph display, conservative additional unit conversions and supported named-call extraction, plus removal of internal IDs/offsets from arithmetic prompt annotations. Ordinary synthesis remains available. Semantic mode/outcome selection is still model judgment; exact source anchoring and deterministic arithmetic are narrower mechanical guarantees.

Freeze: `out/optimization-20261005/i-production-freeze.json`, 2026-10-05T14:21:29.318Z. Production manifest SHA-256 `8560aaf88f2d61989252ba25d8c672e59607032f65706b31dd5c86404a9a65e7`; worker SHA-256 `8f3527f6b3707783d90a6a27e7f80948e713410b9774036a9de96d94541fe85c`. Build provenance matched current sources and compiled bytes were unchanged after execution.

All observed calls used `typed-comparison-v3`, actual 8192-token context, 14 GPU layers, output budget 2176, temperature 0 and repetition penalty disabled. Cases 01–03 restored f16 KV; case 04 restored q8_0 KV at 16:29:04.305 local time, confirmed by its worker log and after-call plan. Its before-call snapshot still described the previous f16 resident model. One raw call per attempt; no grammar fallback. Normal small-document expansion was enabled, while rerank, multi-query and routing remained disabled in the fixed evaluation configuration. Deadline 180 seconds, one repetition, zero Playwright retries; timeout stops collection after cancellation.

## Outcomes

| Case  | Result                            | Material observation                                                                                                                                     | Total     |
| ----- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 01    | Safe-abstention pass              | Exact full-context deadline/approval/replacement qualifications; no invented categorical event claim.                                                    | 117.683 s |
| 02    | Citation partial                  | Correct 4/5 limits and applicability dates; noncanonical grouped marker leaves original-limit source 3:3 absent from the terminal's navigable citations. | 126.783 s |
| 03    | Supported pass                    | Correct compatible volume comparison; source-linked 2.75 m³ = 2750 L conversion is displayed.                                                            | 129.103 s |
| 04    | Timeout; semantic outcome unknown | Both required duration passages supplied. Clean cancellation at the fixed deadline; no final answer or successful parsed outcome.                        | 180.056 s |
| 05–12 | Unobserved here                   | The fail-stop collection policy prevented these eight attempts.                                                                                          | —         |

Case 02 emitted `[doc:4, chunk:4; doc:3, chunk:3]` for the unchanged saw limit. The original answer is preserved; no marker repair was applied to this observation. Its only authoritative terminal citation is 4:4 from an earlier valid marker. Correct values do not make the malformed source link complete.

For case 04, H's earlier prompt estimate was 2558 versus I's 2639, both with 11 fed passages, 8192 context and 2176 output budget. H used f16 KV while I used q8_0; the initial review's assumption of matching KV was corrected against actual restore logs. Retrieval took 6.796 versus 7.159 seconds. H's raw call returned after 156.214 seconds; I's call was cancelled after 162.060 seconds when the overall 180-second deadline expired. Neither the extra estimated input nor any other single change can be assigned causal responsibility: precision, generated output and resource conditions differ, and I01/02 were faster despite longer prompts. These traces cannot distinguish prefill from generation cost or establish whether an eventual answer would have been correct. The worker's exit log is a `finally` log, not a success guarantee.

Startup was 42.380 seconds and indexing 11.213 seconds. Successful observed answers had a median total time of 126.783 seconds (three observations). The timeout remains a separate operational failure; reporting only that successful latency would understate the run's limitations.

## Artifacts and continuation

[manual.json](manual.json) contains independently cross-reviewed judgments. `raw.json` and `review.json` are local generated artifacts. Raw SHA-256: `1c6274f9ac790561ea458d5dffde9172c0c6966cbc1e6de0031911dc01d9db37`. Escaped Markdown punctuation and the sealed corpus's known reference-format defects are not treated as semantic failures solely from regex mismatches.

After this stop, the predeclared [authority controls](../bugfix-20261005-i-known-authority-controls/REVIEW.md) run under the same frozen build. A separately declared [continuation](../bugfix-20261005-i-known-reasoning-continuation/REVIEW.md) covers only unattempted 05–12; its declaration is `out/optimization-20261005/i-continuation-declaration.json`. There is no retry of 04 and no retrospective replacement of this run.
