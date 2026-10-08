# AQ original 180s known13 collection: four strict completions, one timeout

**AQ's four completed answers strictly pass, but the original thirteen-case calibration remains incomplete after reasoning09 timed out.** Five cases were attempted once; eight later cases were never launched. No semantic judgment is assigned to the timeout or unobserved cases.

| Group                                                                         | Requested | Attempted | Completed finals | Strict passes | Timeouts | Unobserved |
| ----------------------------------------------------------------------------- | --------: | --------: | ---------------: | ------------: | -------: | ---------: |
| [AB original cases](../bugfix-20261006-aq-ab-replay/REVIEW.md)                |         3 |         3 |                3 |             3 |        0 |          0 |
| [Early reasoning02/09](../bugfix-20261006-aq-reasoning-gate-replay/REVIEW.md) |         2 |         2 |                1 |             1 |        1 |          0 |
| Original10/06, unlaunched                                                     |         2 |         0 |                0 |             0 |        0 |          2 |
| Remaining reasoning05/06/11/12, unlaunched                                    |         4 |         0 |                0 |             0 |        0 |          4 |
| Transfer01/04, unlaunched                                                     |         2 |         0 |                0 |             0 |        0 |          2 |
| **Total**                                                                     |    **13** |     **5** |            **4** |         **4** |    **1** |      **8** |

[Manual judgments](manual.json) and [safe summary metadata](observations.json) preserve the exact fixed order and all missing observations. Group reports retain the validated finals, source mapping, runtime evidence and provenance.

The three AB finals independently satisfy their unchanged strict keys: both 19/14 intervals with scoped uncertainty and compact display; current 5 projectors / 7 tablets with explicit council nonapproval of the later paper and all three refs; 2375 CHF actual/planned difference in one sentence with both input refs. Reasoning02 correctly gives current 4 drills / 5 saws on the asked date, citing the effective partial amendment and retained base. Its question asks for limits/evidence, so no new explanation requirement is added from the different AB02 key.

Reasoning09 supplied both required 16:17/17:18 passages but reached only a cancelled terminal with the fixed interruption notice at **180.088 seconds**. Nested metadata records constrained-response token activity through 162.265 seconds of native work before cancellation, with 188 constrained-response tokens, 128 thought tokens and 2 forced-closing tokens. It reveals no completed arithmetic, scope explanation or citation choice. No hidden thought/check/envelope content was read or inferred.

## Deadline and comparison limits

The **180-second timer belongs to the calibration harness**, not a production answer deadline. It measures an end-to-end app attempt including retrieval/preparation, while native timing covers a subset. The original criterion and failed timeout remain unchanged. A separately declared longer-window diagnostic, if executed, cannot substitute for this observation, count as an original 180-second pass, fill the eight unrun cases, or authorize fresh-case authorship. An isolated replay also has different first-query preparation than 09 following 02; any future diagnostic must disclose that order difference.

These are known DEV observations under one frozen AQ build, `4ffd56cb9b2717bd3c576a7520e36c8ee9e40b2d5990289bdb92096a6b43f63b`, with v18 check/result, 128 bounded thoughts and compact JSON. Prior AP quality failures, AO timeout and other candidate observations remain unchanged. Schema validity, normal process exit or clean cleanup is not acceptance. The original first-five gate did not achieve five strict completed answers, so all later groups remain held.

Each group used its complete original corpus with actual retrieval and explicit overrides `rerank=false`, `multiQuery=false`, `routing=false`, `wholeDocFallback=true`; this is not all production defaults. All cases were one attempt, zero retries, without gold-source selection or output repair. Both executed groups verified all 421 source / 112 compiled pins plus model/fixture/harness unchanged at closure. Observers drained/disposed without errors/pending replies and no owned native/runner processes remained. Reasoning exited 1 with `safeToContinue=false`.

An owned failure `error-context.md` was generated despite capture settings; it was hashed/removed without reading and its correction is preserved in the reasoning report. All actual observations, logs and declarations remain. Public reports contain safe final/metadata allowlists and repository-relative paths only. No fresh facts, questions, sources or keys were authored. This incomplete small known set establishes neither fresh reliability nor a general latency guarantee.
