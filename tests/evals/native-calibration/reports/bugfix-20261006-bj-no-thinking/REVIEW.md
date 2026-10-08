# BJ ordinary-route diagnostic — parser nonpass

The single BJ01 attempt completed normally, but the executed **v29 parser admitted no final answer**: `answer` / `summary_display`. Strict and product acceptance remain nonpasses; semantic, citation, language and brief-format grades are null. There were zero retries. BH and BI remain separate nonpasses, and no later original or fresh-validation cases were attempted.

The fixed observer reported only **`interior_period`**: 232 UTF-16 units/code points, 231 display code points after the observed terminal dot, within the 368-code-point limit. Counts were not clipped. All otherwise-unadmitted interior dots were covered by the declared public abbreviation whitelist. That boolean is lexical evidence only: it reveals no word, dot position, sentence count, semantic correctness or cause of a historical failure. A terminal dot does not imply successful normalization. No rejected body, private check or thought text was retained or inspected. A successor formatter cannot retroactively change this result.

| Measurement              | Observed |
| ------------------------ | -------: |
| Model load               | 15.662 s |
| Native generation        | 16.854 s |
| Direct call              | 16.880 s |
| Call + parser/diagnostic | 16.887 s |
| Cold arm                 | 33.047 s |
| Cold group               | 33.285 s |
| Through durable closure  | 39.675 s |

The 180-second direct diagnostic target passed; the collection cap remained 300 seconds. Full application latency was not measured. Actual allocation was Vulkan, f16 KV, an 8,192-token context, all 25/25 GPU layers, six threads and 1 GiB reserve.

The original AB01 question/key, eight full passages/order and exact frozen BF prompt/system/schema were unchanged. The bounded-thought field was entirely omitted; the existing ordinary main route observed `noThink: true`, `boundedReasoning: not_requested` and default JSON whitespace, with temperature 0, repeat penalty disabled and 2,176 maximum tokens. Its session, discourage wrapper and generation mechanics differ from the bounded route: this is a whole-route characterization, not a pure cap ablation or causal comparison. No bounded-stage telemetry was reported; actual thought tokens were not independently measured. The prepared-wrapper fit guard ran, but its exact count is not exported. Native token deltas were 1,740 input and 228 output tokens.

Whole closure preceded result inspection: **619 pins matched**, Node/postverifier/worker exits were **0/0/0**, pending requests and forced stops were zero, the profile was removed and no owned/native processes remained. Capture was disabled. Exact BF/BJ request identity does not establish the reconstructed historical BD outbound-wire identity. No default setting changed.

See [manual.json](manual.json) and [observations.json](observations.json) for separate grades, fixed metadata and immutable evidence hashes.
