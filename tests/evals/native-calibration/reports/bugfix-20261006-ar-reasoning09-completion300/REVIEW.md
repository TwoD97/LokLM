# AR reasoning09: supported answer in the separate 300-second diagnostic

**The validated answer passes the original factual, completeness, citation and format criteria. App elapsed time was 184.894 seconds, exceeding 180 seconds by 4.894 seconds.** This is one known DEV observation under a separately declared 300-second calibration window, not a replacement for either AQ failure or a general reliability result.

[Safe observations](observations.json) preserve the exact validated final, actual supplied source order, fixed shape counts and allowlisted runtime metadata. [Manual review](manual.json) records the unchanged semantic criteria separately from timing.

| Requested | Attempted | Validated answers | Strict content/format passes | Timeouts | Above 180 seconds | Unobserved |
| --------: | --------: | ----------------: | ---------------------------: | -------: | ----------------: | ---------: |
|         1 |         1 |                 1 |                            1 |        0 |                 1 |          0 |

## Independent review

The original question asks how many devices passed across both Rilven sector reports and briefly whether the figures may be added. It does not impose a one-sentence limit.

Actual supplied **16:17** states that west has **31** passing devices and covers only serials **700–739**, explicitly excluding 740–779. Actual **17:18** states that east has **34** passing devices and covers only **740–779**, explicitly excluding 700–739. The final gives both inputs, explains their disjoint scope, permits addition and correctly reports **65**. Both canonical references attach the same coherent calculation paragraph. Every added factual claim is supported, and four short sentences meet the brief-explanation request. There is no invented scope, unrelated source, missing requested result or false refusal.

The original manifest, question and reference criteria were not changed. Both required passages were supplied, along with the same eleven passages in the same order and with identical text as the prior AQ completion300 attempt. All eighteen original documents were eligible for retrieval; no gold source selection occurred.

## Candidate and shape observations

AR/v19 retains the AQ generation instructions, JSON schema structure, bounded 128 allowance and maxTokens 2176. Its shared source-label admission additionally recognizes only complete spaced-colon and explicit comma/chunk labels whose canonical IDs already belong to the same answer record. It does not admit grouped or incomplete labels, guess missing IDs, or verify semantic entailment by source membership. The strict content pass above comes from inspecting the final against actual sources.

The opt-in test observer recorded these fixed shape counts in the current completed envelope:

| Shape                                                                                          |  Count |
| ---------------------------------------------------------------------------------------------- | -----: |
| `comma_chunk_pair`                                                                             |      2 |
| `exact_colon_pair`, `spaced_colon_pair`                                                        | 0 each |
| `grouped_complete_pairs`, `no_closing_parenthesis`, `line_break`, `invalid_id`, `other_syntax` | 0 each |

It inspected one block and 362 characters, found two candidates, and was not capped. These are counts only: no pre-cleanup label strings, label IDs or offsets were retained in this field. Co-occurring or protected syntax shapes do not alone establish which exact text was normalized. They also do not reveal the malformed syntax or discarded answer from AQ. No claim of identical generated envelopes or a uniquely established causal fix is made.

## Runtime and limits

The call observed v19 `answered`, active bounded 128 on the main route, compact JSON, q8_0 KV, 8192 context, 14 GPU layers, temperature 0 and repeat penalty disabled. There was no unsupported-wrapper, setup-failed or grammar-fallback status. The completed structure had check/result keys, check string length 120 codepoints and externalLineBreaks=0. Private contents were not inspected.

| Metric                                 |           Observed |
| -------------------------------------- | -----------------: |
| Grammar / prompt fit                   |          5 / 22 ms |
| Exact prompt tokens                    |               2011 |
| Prefill tokens / batches               |           2010 / 8 |
| Thought / forced closing tokens        |            128 / 2 |
| Constrained-response / combined tokens |          203 / 333 |
| Meter input / output tokens            |         2012 / 331 |
| Response character count               |                597 |
| First / last constrained response      | 76.441 / 174.195 s |
| Native completion                      |          174.196 s |
| App completion                         |          184.894 s |

Native generation stopped normally with `stopGenerationTrigger`, `cancelled=false`. Constrained-response counts include private check and JSON syntax, not only the displayed answer. App elapsed time includes retrieval and preparation. The calibration timer was 300 seconds; no production answer deadline changed.

This isolated run was the first question in a new process/profile, whereas original AQ09 followed reasoning02. Candidate admission and execution order therefore differ from the original 180-second observation. The longer allowance and successful final do not retrospectively establish what the interrupted AQ run would have produced. Even this completed AR observation exceeds the old 180-second threshold.

Evaluation overrides were `rerank=false`, `multiQuery=false`, `routing=false`, `wholeDocFallback=true`; these are not all production defaults. There was one attempt, no retry within this run, no output repair, and no criterion change.

**The original AQ180 aggregate remains 4 strict completed answers, 1 timeout and 8 unobserved out of 13 requested.** Its [gate](../bugfix-20261006-aq-reasoning-gate-replay/REVIEW.md), [aggregate](../bugfix-20261006-aq-known-summary/REVIEW.md), and separate [AQ completion300 parser rejection](../bugfix-20261006-aq-reasoning09-completion300/REVIEW.md) remain unchanged. This AR result is neither an AQ continuation nor authorization to fill those eight cases.

## Closure and provenance

Declaration frozen **2026-10-06T05:01:14.971Z**; collection **05:01:43.276Z–05:05:43.562Z**; postverification **05:06:05.924Z**. All **421 source / 112 compiled** pins plus model, fixture and harness pins matched, `currentSourcesMatchBuild=true`, `changedPaths=[]`. Runner exit was 0, `cleanupVerified=true`, `requestCompleted=true`. Observer disposal had zero errors, dropped records or pending replies. No owned native/Playwright process or capture remained; trace/screenshot/video were off.

`safeToContinue=false` is the policy boundary of this isolated diagnostic, despite successful cleanup and request completion. This declaration authorizes no later native group or fresh facts; any later correctness collection requires a separate prospective protocol and grant.

- Build manifest: `c238f16db7574e4638d435a4d7191d47abba20c5670fd54bb1de29f2c255b0ea`.
- Declaration: `out/optimization-20261005/ar-reasoning09-completion300-execution-declaration.json`, SHA256 `6a3c92aad21964bc77261939851f522745617f9189b7b515d2b18d2f5a939c06`.
- Postverification: `out/optimization-20261005/ar-reasoning09-completion300-postverify.json`, SHA256 `8bc05001ef9761a116acf0849ce914977d599ac33dee459b6f3c8fc064117dc0`.
- Local [raw observations](raw.json), SHA256 `64976c8da066814f7e1154565549bb6a8eca77cb6509452d11758a353d803970`.

Raw/log/declaration files are local generated artifacts; tracked review/manual/observations preserve the safe evidence. No hidden thoughts, private check, raw generated envelope or discarded prose was read. Reporting changed no production, harness, fixture or grading criterion and made no model calls.
