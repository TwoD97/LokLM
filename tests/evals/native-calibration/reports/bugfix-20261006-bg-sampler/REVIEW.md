# BG sampler diagnostic — incomplete / nonpass

Four arms were fixed before execution: greedy BG01, then sampled BG02/03/04 with seeds 42, 314159 and 271828. Three arms ran once: one greedy and two sampled. BG01 and BG02 completed normally but failed parser admission; BG03 produced an admitted final that failed strict and product review. BG04 performed **zero inference** because its fresh allocation changed KV precision. There were zero retries or replacement seeds. This is partial development evidence, not a completed four-arm screen or a production improvement.

| Arm  |   Seed | Result                    |     Load |    Native | Direct call | Call + parser |  Cold arm |
| ---- | -----: | ------------------------- | -------: | --------: | ----------: | ------------: | --------: |
| BG01 | Greedy | Parser nonpass (`answer`) | 35.193 s | 136.979 s |   137.179 s |     137.181 s | 173.105 s |
| BG02 |     42 | Parser nonpass (`answer`) | 35.002 s | 152.143 s |   152.343 s |     152.345 s | 188.070 s |
| BG03 | 314159 | Strict/product nonpass    | 34.764 s | 118.515 s |   118.715 s |     118.720 s | 154.271 s |
| BG04 | 271828 | Unattempted: KV mismatch  | 34.891 s |         — |           — |             — |  35.382 s |

All three completed calls met the separate 180-second **direct diagnostic** target. The collection cap remained 300 seconds per call. Full application latency was not measured. Cold group wall time was 562.069 seconds, including the fourth load and final closure; loading and cleanup are not subtracted to imply a faster product turn.

## Exact accepted final and grading

BG03's admitted final was 204 code points:

> Aus den bereitgestellten Textstellen geht keine eindeutige Antwort hervor: Nord gilt mit 14 Tagen, Süd 19 Tage (S8-Kampagne), kein Vorrang/Freigabe belegt für Überlegene. [doc:1, chunk:1] [doc:2, chunk:2]

Both values, North/South mapping, canonical citation coverage, German language and brief sentence form pass separately. However, “Nord gilt mit 14 Tagen” blurs a reported value with binding status; “für Überlegene” introduces an unsupported, unclear referent. The exact wording cannot be silently repaired. Strict and product acceptance therefore fail. “Kein … belegt” is documentary wording, so this is **not** graded as a proven global-absence overclaim.

BG01/02 have no admitted final. Their semantic, citation, language and format grades remain null. BG04's unattempted grades also remain null. No rejected envelope, private check or thought body was retained or inspected.

## Frozen comparison and sampler

All arms retained the original AB01 question/key, eight complete passages in recorded order, the exact frozen BF prompt/system/schema/parser, 2,176 total tokens and 128 thought tokens. BF reconstructed the historical BD request from recorded passages/metadata and frozen prompt code; original outbound BD wire bytes were not retained. Exact BF/BG and within-group identity is proven; historical BD wire identity is not. BG01 is the fresh control.

The greedy arm forwarded original evaluate options unchanged. Both stages of each completed sampled arm used temperature 1, top-p 0.95, top-k 20, min-p 0, presence penalty 1.5, repetition penalty 1, frequency penalty 0 and maximum penalty history 2,176. Each phase creates a new SDK sampler, so the same declared arm seed **restarts at the phase boundary**. These are Qwen-recommended values under this bounded adapter, not serving-framework parity or continuous RNG.

Penalty history included only naturally yielded completion tokens across stages, excluding prompt/prefill, bridge commits and manually forced closing tokens. All completed arms reached the 128-token thought cap and injected two closing tokens. Fixed receipts verify both stages, history counts, drains and clears. Facade-owned history/reference state was cleared; ephemeral SDK/native copies are not proven erased. The reversible OUT shadow retained the original bounded engine, loading, FIFO, abort and retirement behavior without production or SDK prototype edits.

## Operational closure and limits

BG01–03 matched Vulkan, 8,192-token context, f16 KV, 14/33 GPU layers, six threads and 1 GiB reserve. BG04 selected q8_0 KV with the other recorded settings unchanged. The equality guard stopped it before generation. Allocator attempt reasons were not retained; no cause is inferred from the observed allocation change.

The original Node and postverifier exits remain **1/1**. The original verifier requires a successful group-result artifact, which is absent after this declared operational stop. Separate failure closure verified all **620 pins at closure**, four worker exits 0, pending requests 0, forced stops 0, zero owned/native processes, removed profiles and capture disabled. Electron exits were 0/0/0/1. Cleanup passed; the planned screen did not. Accepted-final inspection followed that closure.

Historical source pins describe the closed run. Root normalized SDK patch line endings afterward with the normalized pnpm hash unchanged; these historical pins are not a claim about the later workspace. The fresh validation set remains unopened. No default adoption, replacement seed or further run is authorized by this report.

See [manual.json](manual.json) for separate grades and [observations.json](observations.json) for timings, fixed sampler receipts and immutable evidence hashes.
