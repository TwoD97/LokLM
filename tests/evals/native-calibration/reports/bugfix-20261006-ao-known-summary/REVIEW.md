# AO known replay: incomplete after one timeout

**AO produced five strict passes, then timed out on the sixth attempted case. Four requested cases remain unobserved.** The ten-case acceptance queue did not pass; no fresh corpus was authored or launched.

| Group                                                                   | Requested | Attempted | Completed finals | Strict passes | Timeouts | Unobserved |
| ----------------------------------------------------------------------- | --------: | --------: | ---------------: | ------------: | -------: | ---------: |
| [Original regressions](../bugfix-20261006-ao-original-replay/REVIEW.md) |         2 |         2 |                2 |             2 |        0 |          0 |
| [Reasoning controls](../bugfix-20261006-ao-reasoning-replay/REVIEW.md)  |         6 |         4 |                3 |             3 |        1 |          2 |
| Transfer controls, never launched                                       |         2 |         0 |                0 |             0 |        0 |          2 |
| **AO total**                                                            |    **10** |     **6** |            **5** |         **5** |    **1** |      **4** |

The five completed finals all satisfy their unchanged original factual, completeness, format and local-attribution criteria. This does not convert the timeout or unobserved cases into passes. [Combined manual judgments](manual.json) mark unobserved cases explicitly; [safe summary metadata](observations.json) links exact group evidence and preserves the denominator.

| Fixed order | Case                  | Result                                                                        | App seconds |
| ----------- | --------------------- | ----------------------------------------------------------------------------- | ----------: |
| 1           | heldout-10            | Strict pass: both ISO deadlines, scoped uncertainty, local refs, short format |     130.811 |
| 2           | heldout-06            | Strict pass: planned/actual 4755 GBP difference, correct tables, short format |     163.067 |
| 3           | reasoning-reserved-02 | Strict pass: current 4 drills / 5 saws with effective amendment               |     179.767 |
| 4           | reasoning-reserved-05 | Strict pass: current 72 EUR versus explicitly unvoted 81 EUR                  |     153.077 |
| 5           | reasoning-reserved-06 | Strict pass: compatible 12@08:00 / 17@18:00 observations                      |     174.563 |
| 6           | reasoning-reserved-09 | Operational timeout; no completed semantic answer                             |     180.234 |
| 7           | reasoning-reserved-11 | Unobserved                                                                    |           — |
| 8           | reasoning-reserved-12 | Unobserved                                                                    |           — |
| 9           | authority-transfer-01 | Unobserved                                                                    |           — |
| 10          | authority-transfer-04 | Unobserved                                                                    |           — |

Case 09's required Rilven passages were supplied. Progress counters show decoding before cancellation, but no retained final supports an arithmetic, scope or citation judgment. Case 02 completed with only **0.233 seconds** of margin and case 06 with **5.437 seconds**; these measured deadline risks remain visible alongside their semantic passes. No retry, altered deadline, continuation, repair or revised grade was used to fill the missing observations.

## Separate carried AN evidence

The prior [AN AB3 replay](../bugfix-20261006-an-ab-replay/REVIEW.md) had **3/3 strict semantic passes** on build `570cba0cae53bf5cbf3ae110c5891fba6830dc4aa8536862da551d81d12aa7c4`. AN AB02 still recorded one external JSON line break despite the compact start marker; that formatting discrepancy is preserved in its report.

AO retained AN's exact v16 prompt/schema/128 allowance and corrected first-stop-trigger residue handling on build `564eb3cd028a8f4f7c51ce4f3f6cf7f08ea88de96af16fd5bd05819b9a3ff7c5`. AN's three cases were not rerun as part of AO. Consequently, there are eight strict completed answers across **two builds**, but no completed 13-case same-build acceptance claim. Earlier AC/AI/AJ/AK/AL/AM failures and diagnostic observations remain unchanged. AM's missing explicit nonapproval explanation remains its historical strict-rubric partial, even though the literal requested decision, values and citations were correct; AN later supplied that explanation.

## Configuration and evidence preservation

Original, reasoning and planned transfer groups use their full six-, eighteen- and twelve-document corpora respectively. The actual application configuration explicitly sets `rerank=false`, `multiQuery=false`, `routing=false`, `wholeDocFallback=true`, with 180 seconds per question, one attempt and zero retries. This is not “all production defaults.” No gold-source selection or output repair occurs.

Both executed groups matched all **419 source / 112 compiled** pins plus model, fixtures and harness at their own closure. Original exited 0 with `safeToContinue=true`; reasoning exited 1 after the timeout with `safeToContinue=false`. Observers drained/disposed with zero errors/drops/pending replies and no owned native/Playwright processes remained. The queued transfer group was never launched.

Reasoning failure generated an owned `error-context.md` despite trace/screenshot/video being off. Its bytes were hashed and removed without reading under explicit authorization; the group report preserves that exception and correction hash. All actual observations, logs, declarations and postverification remain preserved. Public reports retain only exact validated finals/fixed terminal notices and allowlisted metadata; local raw artifacts remain explicitly labeled generated.

The eight-case future protocol is metadata only. Its facts, questions, sources and grading keys remain unauthored. Acceptance and explicit candidate/model/protocol freeze plus authorship authorization are required before any future set is written. This known DEV collection establishes neither unseen-case reliability nor a latency guarantee.
