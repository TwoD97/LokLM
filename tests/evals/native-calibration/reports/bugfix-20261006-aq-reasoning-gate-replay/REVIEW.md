# AQ early reasoning gate: one strict pass, one timeout

**Case 02 strictly passes; case 09 timed out without a completed answer.** Both declared attempts were collected once. This original 180-second gate failed operationally, so all eight later AQ cases remain unobserved and no fresh facts were authored.

[Safe observations](observations.json) retain the exact completed answer, fixed interruption notice, actual fed source IDs/order and allowlisted counters. [Manual judgments](manual.json) preserve the unchanged original criteria and refrain from a semantic verdict for the timeout.

| Case                  | Result                                   | App seconds | Native seconds |
| --------------------- | ---------------------------------------- | ----------: | -------------: |
| reasoning-reserved-02 | Strict pass                              |     146.812 |        136.086 |
| reasoning-reserved-09 | Operational timeout; no semantic verdict |     180.088 |        162.729 |

Group requested/attempted/completed/strict passes: **2/2/1/1**; timeouts: **1**. Combined with the separate [AQ AB3 passes](../bugfix-20261006-aq-ab-replay/REVIEW.md), the original AQ13 plan has **5 attempted, 4 completed strict passes, 1 timeout and 8 unobserved**. It is not a completed acceptance run. See the [combined summary](../bugfix-20261006-aq-known-summary/REVIEW.md).

## Independent original-criteria review

**02 passes.** Actual supplied base 3:3 gives the unchanged 5-saw limit. Approved amendment 4:4 changes only drills to 4, effective 2031-05-15 before the asked 2031-06-01. The final gives current 4 drills and 5 saws with both canonical references on the answer, without unsupported extras. The original question requests the two limits and evidence, not an additional authority explanation; the separate AB02 key's explanation requirement is not imported into this case.

**09 is operationally ungraded for meaning.** Required actual passages 16:17 and 17:18 were both supplied: they contain the relevant counts and disjoint ranges. The only terminal text is the fixed interruption notice. There is no completed sum, scope explanation or citation selection to assess. The cancelled terminal settled; neither a substantive model failure nor a hidden successful answer is inferred.

The 180-second timer is a calibration-harness criterion, not a production answer deadline. The original questions, references and grades remain unchanged. No retry, repaired answer, later diagnostic or changed deadline may replace this failed 180-second observation.

## Content-free timing evidence

Both calls observed v18/full plans, active bounded128 on the main route, q8_0 KV, 8192 context, 14 GPU layers, temperature 0, repeat penalty disabled and maxTokens 2176. Both worker start markers reported compact JSON, with no unsupported-wrapper/setup-failed/grammar-fallback status. Case 02 completed normally with `stopGenerationTrigger`; its parsed envelope had check/result keys, a 120-codepoint string check and externalLineBreaks=0. Case 09 had a worker-error observation with no retained envelope, so it has no JSON completion/whitespace quality claim.

| Case | Prompt tokens | Prefill tokens / batches | Thought | Forced closing | Constrained response | Combined |
| ---- | ------------: | -----------------------: | ------: | -------------: | -------------------: | -------: |
| 02   |          1983 |                  1982 /8 |     128 |              2 |                  129 |      259 |
| 09   |          2011 |                  2010 /8 |     128 |              2 |                  188 |      318 |

For 09, nested counters report first/last constrained-response token at 77.568 / 162.265 seconds from native invocation, before cancellation at 162.729 seconds native and 180.088 seconds app elapsed. Top-level retained response characters are 0, completion reason is null and cancelled is true. This records continuing token activity before the deadline; it does not establish the exact unfinished text, whether completion was imminent, or a causal explanation for latency. Constrained-response tokens include private check and JSON syntax, not only user-facing prose. No hidden/check/raw envelope was read.

All 18 original documents were eligible and 11 passages were actually supplied for each case. Exact evaluation overrides were `rerank=false`, `multiQuery=false`, `routing=false`, `wholeDocFallback=true`, app 180s, one attempt and zero retries; this is not all production defaults. There was no gold-source filter or output repair. `continueErrors=true` does not override native-timeout stop policy.

## Closure and evidence preservation

Declaration frozen **2026-10-06T04:25:23.130Z**; collection started **04:25:57.992Z**; postverification **04:32:41.249Z**. All **421 source / 112 compiled** pins plus model/fixture/harness hashes matched with no changed paths. Observer disposal had zero errors/drops/pending replies, and no owned native/Playwright process remained. Runner exit 1 and `safeToContinue=false` stopped the queue.

Trace/screenshot/video were configured off. An owned `error-context.md` was nevertheless generated; it was hashed and removed without content inspection after containment checks. Correction metadata is preserved at `out/optimization-20261005/aq-reasoning-gate-capture-correction.json`, SHA256 `8603e8a304177ab2d5b98fba15c544a229eea82850d833195637e68fd2b55891`. Do not retroactively claim no artifact was generated. All actual observations/logs/declarations remain; no capture file remained after cleanup.

- Build manifest: `4ffd56cb9b2717bd3c576a7520e36c8ee9e40b2d5990289bdb92096a6b43f63b`.
- Compiled worker: `2b5751b66659b31cc6307e52bd3764d92d681e44b6f8154956b0c4890ea0eb35`.
- Declaration: `out/optimization-20261005/aq-reasoning-gate-replay-execution-declaration.json`, SHA256 `5595a2b092430fefca843a43a62844fc902f715cf0e98e4f528d54cdbab43162`.
- Postverification: `out/optimization-20261005/aq-reasoning-gate-replay-postverify.json`, SHA256 `83b6acda53321ce720113523a76dff3d3e5ecf6c5251f32739494b6f628805b1`.
- Local [raw observations](raw.json), SHA256 `837d79ec261ac80ab508916936577c4af0caf1334bcbe377248d330489bfe75d`.

Raw/log/declaration/correction files are generated local artifacts; tracked review/manual/observations preserve safe evidence. No production, harness, fixture or criterion changed during report preparation, and no model or new validation set was launched.
