# AK compact-JSON app replay: one strict pass, two partial nonpasses

**All three known AB cases completed within the declared app deadline. Only AB03 passed the original quality criteria.** AB01 omitted North's interval; AB02 gave correct limits but omitted support for its working-paper claim. There were zero timeouts, retries or unobserved cases. Compact output and successful parsing are runtime evidence, not semantic validation.

[Tracked observations](observations.json) preserve all exact final answers, actual supplied source order and allowlisted treatment metadata. [Manual judgments](manual.json) retain the independent original-criteria assessment. No private check, hidden thoughts/token arrays or raw generation envelope was inspected or copied into these artifacts.

| Order | Case        | Strict result                                                    | App seconds | Native seconds | Final mode              |
| ----- | ----------- | ---------------------------------------------------------------- | ----------: | -------------: | ----------------------- |
| 1     | ab-fresh-01 | Partial: required alternative absent, excessive irrelevant units |      97.946 |         87.241 | Comparison / unresolved |
| 2     | ab-fresh-02 | Partial: working-paper claim lacks its source                    |     119.735 |        102.390 | Answered                |
| 3     | ab-fresh-03 | Pass                                                             |     116.722 |         99.615 | Answered                |

## Independent original-criteria review

**AB01 is incomplete, not a manufactured binding winner.** Its lead explicitly says no definitive answer follows from the supplied excerpts. The only displayed interval is quoted as South's stated 19 days, not asserted to govern both notes. The displayed qualification also faithfully says that South contains no approval signature or priority statement; it does not assert that approval never occurred.

Nevertheless, the answer selects four units from South 2:2 only: heading, issue date, interval and qualification. It omits North's required **14 days** and reference 1:1, although South and North were both actually supplied first in context. The heading/date units add irrelevant material and do not satisfy the requested compact one-sentence comparison. Every selected fragment is real, but an incomplete set of real fragments is not a complete answer. The result remains a strict nonpass even though its uncertainty wording is safe.

**AB02 gets the values right but does not fully support its answer.** Current **5 projectors** and **7 tablets** are correct: amendment 4:4 changes only projectors, effective before the asked date, while base 3:3 supplies the retained tablet value. Both references attach the coherent paragraph. The final then says, “The later tablet working paper does not change those limits.” That is true in the complete corpus, but the required proposal passage **5:5 is absent from the answer's citations**. Base and amendment alone do not establish the later paper's authority or effect. Passage 5:5 was actually supplied second in context, so this is not retrieval loss. The original rubric also requires explicit nonapproval, which the final does not state. No invented nonapproval sentence is attributed to this answer; its defect is incomplete attribution and explanation of the true working-paper result.

**AB03 passes.** Planned main-campus licensing receipts of 29835 CHF for 2037 exceed recorded receipts of 27460 CHF for 2036 by **2375 CHF**. The one short sentence preserves years and actual/planned status, cites both actual supplied input passages 6:6 and 7:7 locally, and does not use the reserve or Annex figure. The question does not require repeating both input amounts.

The original questions, sources, grading key and claim-level criteria are unchanged. The aggregate is **1/3 strict passes and two partial nonpasses**. There is no critical wrong current value in AK02, unlike AJ02; correct values still do not erase its citation gap.

## Observed treatment and timing

AK uses `typed-comparison-v14`, restoring the AI check-plus-result response and system contract. Compact recognized JSON structural whitespace is enabled only for the supported bounded worker path. The thought allowance, combined output budget, source text, validators and comparison branches retain their declared settings. This is a known DEV replay, not new transfer validation.

All eight original documents were indexed, with actual app retrieval and default whole-document expansion. The established harness disables reranking, multi-query and routing. The three calls received 8, 8 and 7 passages; every required passage was supplied. No gold-source filter or output repair was used.

All three calls observed:

- Active bounded reasoning on the main route, maximum 64 thought tokens, q8_0 KV, 8192-token context and 14 GPU layers.
- Temperature 0, repeat penalty disabled and maxTokens 2176.
- A fixed worker start marker containing `boundedReasoning=active jsonWhitespace=compact`.
- A successfully parsed observer envelope with root keys `check` and `result`, check type string and length 120 codepoints, and **`rows[].capture.externalLineBreaks = 0`**.
- Normal `stopGenerationTrigger`, one completed terminal, settled invocation and no unsupported-wrapper, setup-failed or grammar-fallback event.

The exact observer scalar is `capture.externalLineBreaks`, not a `formatting` field. It counts line breaks outside JSON strings only after successful parsing; escaped source newlines do not contribute. That count does not inspect or validate the private check's meaning. The tracked artifact copies only the fixed type/length/count metadata, never its contents.

| Case | Prompt tokens | Prefill tokens / batches | Thought tokens | Forced closing | Constrained response tokens | Combined |
| ---- | ------------: | -----------------------: | -------------: | -------------: | --------------------------: | -------: |
| AB01 |          1532 |                 1531 / 7 |             64 |              2 |                          92 |      158 |
| AB02 |          1377 |                 1376 / 6 |             64 |              2 |                         141 |      207 |
| AB03 |          1218 |                 1217 / 5 |             64 |              2 |                         137 |      203 |

Constrained-response counts include JSON syntax and the private check, not just displayed prose. The 180-second app deadline includes retrieval/preparation; native timing is only its generation portion. These calls were shorter than the corresponding AJ observations, but this small sequential collection does not establish an isolated causal latency or quality effect. All three completed; two still failed strict quality review.

[AI](../bugfix-20261006-ai-ab-replay/REVIEW.md), [AJ](../bugfix-20261006-aj-ab-replay/REVIEW.md), [AC's original failures](../bugfix-20261005-ac-fresh-validation/REVIEW.md), and the earlier [AG](../bugfix-20261005-ag-text-first/REVIEW.md)/[AH](../bugfix-20261005-ah-text-first-controls/REVIEW.md) diagnostics remain preserved separately. No earlier failure is replaced by this run, and no general repair or promotion claim follows from it.

## Provenance and cleanup

The declaration froze at **2026-10-06T01:58:34.234Z**. Collection ran **01:58:54.883Z–02:05:21.104Z**; postverification completed at **02:05:43.602Z**. All 419 source and 112 compiled pins, model, fixture and harness bytes matched. The runner exited 0, the observer was disposed with zero errors/drops/pending replies, and no owned native or Playwright process remained. Existing unrelated Ollama processes were untouched. Trace, screenshot and video capture were explicitly off before this run.

- Build manifest SHA-256: `c10051ebfd1d15adfd6a8d0467c6abcf17227d07c52694d842f2df4a960f8669`.
- Compiled worker SHA-256: `346a4e890acf189b4f54bbad7d13770430d3664c0e9260d4e1b3bfcfb29870d9`.
- Harness SHA-256: `05c96a790584a3cdc5badbc77c947a893527df5d8130b805a8ab765b89f25a03`.
- Execution declaration: `out/optimization-20261005/ak-ab-replay-execution-declaration.json`, SHA-256 `89c7e29d47f046475fecd3922874da3c4f6b2cceb5f7bd3645ba42163a973526`.
- Postverification: `out/optimization-20261005/ak-ab-replay-postverify.json`, SHA-256 `1605017886552e572f4e51e2af048bcdc18965e499a8b563988daee708dc7c3f`.
- Original local [raw observations](raw.json), SHA-256 `339da797240c17485d6dfb4b0518a0d37c9e69904243359b3e80b3b5d5592f29`.

Raw/log/declaration files are generated local artifacts. The review, manual judgments and safe observations preserve the assessment in version control. Preparing this report did not change production, harness, fixtures or gold criteria, and did not launch a model or author a new case set.
