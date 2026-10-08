# AJ result-only app replay: all three complete, one strict pass

**AJ completed all three known AB cases within the 180-second app deadline, but only AB03 passed the original quality criteria.** AB01 omitted a required alternative; AB02 gave a wrong current tablet limit. There were no timeouts, retries or unobserved cases. Successful collection and valid structured output do not establish answer correctness.

[Tracked observations](observations.json) preserve every exact final answer, actual supplied source order and safe runtime counters. [Manual judgments](manual.json) record the independent original-criteria review. No hidden thoughts, private checks or raw generation envelopes were inspected or retained in these tracked artifacts.

| Order | Case        | Strict result                                   | App seconds | Native seconds | Final mode              |
| ----- | ----------- | ----------------------------------------------- | ----------: | -------------: | ----------------------- |
| 1     | ab-fresh-01 | Nonpass: incomplete, excessive irrelevant units |     115.958 |        105.319 | Comparison / unresolved |
| 2     | ab-fresh-02 | Critical factual failure                        |     163.417 |        145.699 | Answered                |
| 3     | ab-fresh-03 | Pass                                            |     136.972 |        119.725 | Answered                |

## Independent review against original criteria

**AB01 fails completeness and short-format requirements.** The answer correctly limits uncertainty to the supplied excerpts and faithfully displays South's 19-day interval. However, it selects four South-only units: the heading, issue date, interval and qualification. North's required 14-day alternative and reference 1:1 are missing. Both original notes were actually supplied first in the context, in South/North order; this is not retrieval loss. The heading/date material is irrelevant to the requested compact comparison. Correct source text and a safe uncertainty lead do not compensate for the missing value. The answer does not invent a winner, approval denial or replacement event.

**AB02 critically fails the current-value decision.** The final answer says staff may lend “5 portable projectors and 9 tablets,” then correctly says the later working paper is unapproved and does not change those limits. The actual supplied base 3:3 sets **7** tablets. Approved amendment 4:4 changes only projectors to **5**, effective before the asked date, and explicitly preserves other provisions. Proposal 5:5 suggests **9** tablets but explicitly lacks approval and authority. Thus current 9 is false even though all three real source references appear beside the paragraph. Citation identity and coverage are present; the cited evidence does not entail that claim. Projectors 5 and the proposal's nonapproval are correct separately. This differs from AC's earlier wording: AJ does not explicitly say the base rule states 9, so no such additional claim is attributed to this output.

**AB03 passes.** Actual main-campus receipts of 27460 CHF in 2036 and planned receipts of 29835 CHF in 2037 yield **2375 CHF**. The answer preserves years and actual/planned status, cites actual supplied 6:6 and 7:7 locally, and uses one short sentence. It does not add the separate reserve or use the Annex figure. The question does not require repeating both input amounts in the answer.

All three judgments use the unchanged original questions, sealed grading criteria and actual supplied chunks. No reference answer or criterion was revised from these outputs. The aggregate is **1/3 strict passes**, including one incomplete answer and one critical factual failure.

## Treatment, runtime and comparison limits

AJ uses `typed-comparison-v13`: a result-only constrained response after the same bounded 64-token thought phase. Ordinary text-before-sources order, comparison branches and strict validators remain in place. All eight original documents were indexed; actual app retrieval and default whole-document expansion supplied 8, 8 and 7 passages respectively. Every required passage was present. The established harness disables reranking, multi-query and routing; there is no gold-source selection or post-generation repair.

All three calls logged an **active** bounded adapter on the main route, q8_0 KV, 8192-token context, 14 GPU layers, temperature 0, repeat penalty disabled and maxTokens 2176. AB01 used the concise 31-unit catalog; AB02 and AB03 used full mode. No unsupported-wrapper, setup-failed or grammar-fallback status was observed. Every call ended with `stopGenerationTrigger`, one completed terminal and a settled invocation.

| Case | Prompt tokens | Prefill tokens / batches | Thought tokens | Forced closing | Constrained response tokens | Combined |
| ---- | ------------: | -----------------------: | -------------: | -------------: | --------------------------: | -------: |
| AB01 |          1519 |                 1518 / 6 |             64 |              2 |                         128 |      194 |
| AB02 |          1364 |                 1363 / 6 |             64 |              2 |                         225 |      291 |
| AB03 |          1205 |                 1204 / 5 |             64 |              2 |                         176 |      242 |

These are content-free counters. The constrained-response count includes JSON syntax and is not a measure of displayed prose. The app deadline includes retrieval/preparation; native timing measures only its generation portion. App/native times are not interchangeable with the earlier direct SDK diagnostics.

[AI](../bugfix-20261006-ai-ab-replay/REVIEW.md) completed AB01 correctly, timed out on AB02 and never attempted AB03. AJ completed every case but did not preserve AI's AB01 completeness and still failed the authority task semantically. This observation does not prove a causal timing or quality effect from removing the check field. [AC's original failures](../bugfix-20261005-ac-fresh-validation/REVIEW.md), [AG](../bugfix-20261005-ag-text-first/REVIEW.md) and [AH](../bugfix-20261005-ah-text-first-controls/REVIEW.md) remain unchanged. This is a known DEV replay, not newly sealed validation or evidence of general reliability.

## Provenance and cleanup

The declaration froze at **2026-10-06T01:32:38.480Z**. Collection ran from **01:33:00.800Z** to **01:40:49.889Z**; postverification completed at **01:41:11.219Z**. All 418 source and 112 compiled pins, model bytes and fixture hashes matched. The process exited 0; the observer was disposed with zero errors, dropped rows or pending replies, and no owned Electron/native process remained.

- Build manifest SHA-256: `1ca0a83aa5c698907ce7d19f1015b8f6637226c3617665cfe39cc13a02237db8`.
- Compiled worker SHA-256: `03eb9a1832c4895dd031878a65214f01a7b64a98ece98a0900e056adc0c58113`.
- Execution declaration: `out/optimization-20261005/aj-ab-replay-execution-declaration.json`, SHA-256 `37b0820657eb3db646b30259170ebd02262216b23ed22b0bf3d1fde62dda28f5`.
- Postverification: `out/optimization-20261005/aj-ab-replay-postverify.json`, SHA-256 `50a242e811d557d2c989add45a37c4fd0084e87082156f75aee6ca631bbbedc8`.
- Original local [raw observations](raw.json), SHA-256 `081ad6c5b4b3db5abed887d57388c6c705171ba89771e904572a2407443d6087`.

Raw/log/declaration artifacts are generated local files. The review, manual judgments and allowlisted observations preserve the result in version control. Unlike the historical AI run, this declaration explicitly disabled Playwright trace, screenshot and video capture before execution. The harness fingerprint is `5f61cf6063e3876ad736adfeaa2009f3aad4c4985c30d9cfeab9a5e38a26a97f`; that later capture correction is not retroactively attributed to AI.

No production, harness, corpus or grading changes were made while preparing this report. No new cases were authored and no additional native calls were made.
