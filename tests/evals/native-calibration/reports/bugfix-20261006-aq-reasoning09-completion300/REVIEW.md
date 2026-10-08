# AQ reasoning09 completion diagnostic: generation stopped, answer rejected

**The isolated 300-second diagnostic reached normal native completion, then failed strict parsing. No gradeable answer was published.** One case was attempted once; no timeout or retry occurred. App elapsed time was **183.788 seconds**, including **173.088 seconds** of native work. The fixed rejection was broad `answer`, detail `source_label_malformed`.

[Safe observations](observations.json) retain only the fixed failure notice, actual fed source order, fixed rejection codes and allowlisted counters. [Manual review](manual.json) assigns no factual, arithmetic, scope or citation verdict to the discarded result. The exact malformed source-label syntax and rejected prose are unknown and were not inspected.

| Requested | Attempted | Normal native completions | Validated answers | Parser rejections | Timeouts | Unobserved |
| --------: | --------: | ------------------------: | ----------------: | ----------------: | -------: | ---------: |
|         1 |         1 |                         1 |                 0 |                 1 |        0 |          0 |

## What this observation establishes

The unchanged question asks for the total passed devices across the two Rilven sectors and a brief explanation of whether addition is valid. Both required passages 16:17 and 17:18 were supplied, along with the same other passages in exactly the original AQ09 fed order and with identical source text. Retrieval omission does not explain the lack of a final here.

Native generation ended normally with `stopGenerationTrigger`, `cancelled=false`; the observer received a valid compact check/result JSON envelope. The production parser then reported `answer` / `source_label_malformed`, and the app emitted only its fixed failure notice. Valid JSON is not a publishable answer. The diagnostic code does not identify the offending characters, numeric result, selected source, hidden check or precise rejected claim; none is inferred.

This repeat shows that this isolated attempt continued to a generation stop within its longer window. It does not prove why the original run timed out, that the original run would have produced the same rejected result, or that its unfinished output was correct. **The original 180-second AQ09 timeout and AQ13 aggregate remain unchanged:** 4 strict completed answers, 1 timeout and 8 unobserved out of 13 requested. See the [original gate](../bugfix-20261006-aq-reasoning-gate-replay/REVIEW.md) and [unchanged aggregate](../bugfix-20261006-aq-known-summary/REVIEW.md).

## Declared difference and runtime

This was a separately authorized, diagnostic-only repeat of the known failed case with a 300-second calibration window. It used the same frozen AQ build/model, full 18-document corpus, v18 check/result contract, bounded 128, maxTokens 2176 and original semantic/citation/format criteria. It was the first question in a new process/profile rather than 09 following 02. That preparation/order difference prevents treating timing or output as a paired isolated deadline effect. The timer belongs to calibration; no production answer deadline changed.

Actual allocation was q8_0 KV, 8192 context and 14 GPU layers. The call observed temperature 0, repeat penalty disabled, active bounded 128 on the main route, compact JSON and no unsupported-wrapper/setup-failed/grammar-fallback status. Captured structure had check/result keys, check string length 120 codepoints and externalLineBreaks=0. Only that scalar structure was read; private contents remained discarded.

| Metric                                             |          Observed |
| -------------------------------------------------- | ----------------: |
| Grammar / prompt fit                               |          5 /20 ms |
| Exact prompt tokens                                |              2011 |
| Prefill tokens / batches                           |           2010 /8 |
| Thought / forced closing tokens                    |            128 /2 |
| Constrained-response / combined tokens             |          203 /333 |
| Meter input / output tokens                        |         2012 /331 |
| Reported response character count before rejection |               597 |
| First / last constrained-response timing           | 77.051 /173.085 s |
| Normal native completion                           |         173.088 s |
| App error terminal                                 |         183.788 s |

The character count is metadata, not retained rejected text. Constrained-response counts include private check and JSON syntax, not only user-visible prose. The gate found no publishable final despite normal native completion.

Actual retrieval used all 18 eligible documents, 11 fed passages and explicit evaluation overrides `rerank=false`, `multiQuery=false`, `routing=false`, `wholeDocFallback=true`, one attempt and no retry within this diagnostic. This is not all production defaults. No source/gold filtering, repair or question change occurred. It grants no continuation of the original eight held cases or fresh authorship.

## Closure and provenance

Declaration frozen **2026-10-06T04:38:58.036Z**; collection started **04:39:26.615Z**; postverification **04:44:08.378Z**. All **421 source / 112 compiled** pins plus model, fixtures and harness matched, with `currentSourcesMatchBuild=true` and no changed paths. Observer disposal recorded zero errors/drops/pending replies and no owned native or Playwright processes remained.

Runner exit 1, `operationallyClosed=false` and `safeToContinue=false` are preserved exactly. Here `operationallyClosed=false` reflects the finalizer's unsuccessful-request/exit-code predicate; provenance and physical process/observer cleanup were verified. It is not evidence of a still-running process.

Trace/screenshot/video were off. The owned failure `error-context.md` was nonetheless generated, hashed and removed after containment checks without reading its contents. Correction metadata remains at `out/optimization-20261005/aq-reasoning09-completion300-capture-correction.json`, SHA256 `f96ad0f54b24c1c3b5d3b6fb297df737ce17564746759723bcdd03f87d9db963`. No capture remained after cleanup; all actual observations/logs/declarations were retained.

- Build manifest: `4ffd56cb9b2717bd3c576a7520e36c8ee9e40b2d5990289bdb92096a6b43f63b`.
- Compiled worker: `2b5751b66659b31cc6307e52bd3764d92d681e44b6f8154956b0c4890ea0eb35`.
- Declaration: `out/optimization-20261005/aq-reasoning09-completion300-execution-declaration.json`, SHA256 `66608f74d207ae49d7fc93f972676ded1b23bd3d786ec4d760a4a87a981a8edc`.
- Postverification: `out/optimization-20261005/aq-reasoning09-completion300-postverify.json`, SHA256 `774babd8951fcb540e2169172be68c18d2f2f793833942b8ee3ad151040335f9`.
- Local [raw observations](raw.json), SHA256 `1fb3ea26c2d42fe3a979c456b4afb460ce49eb4b80f584f2dc001586fb46ba6d`.

Raw/log/declaration/correction files are generated local artifacts; tracked review/manual/observations preserve safe evidence. No private thought, check, raw generated envelope or rejected prose was read. No production/harness/fixture/criterion changed during reporting, no additional model call was made, and no fresh facts were authored.
