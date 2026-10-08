# BI display observation — parser nonpass

This separately declared, one-attempt diagnostic retained the unchanged model, request and parser. The parser again admitted **no final answer**, returning `answer` / `summary_display`. Strict and product acceptance are nonpasses; semantic, citation, language and format grades remain null. BH's earlier nonpass remains separate and unchanged. There were zero retries, no default change and no further original or fresh-validation cases.

The OUT-only classifier observed one category: **`interior_period`**. Raw summary length was 232 UTF-16 units/code points, below its 368-code-point limit. The diagnostic display span after the observed terminal dot had 231 code points; no counts were clipped. This describes a terminal-dot condition, not successful normalization or parser acceptance.

The fixed public abbreviation-coverage boolean was **false**. That means at least one otherwise-unadmitted interior dot was outside the declared small lexical whitelist. It does **not** prove a genuine sentence break, rule out other abbreviation forms, identify any rejected word or establish BH's cause. No rejected body, substring, dot position, private check or thought text was retained or inspected. The classifier never changed admission.

| Measurement              | Observed |
| ------------------------ | -------: |
| Model load               | 15.052 s |
| Native generation        | 14.652 s |
| Direct call              | 14.830 s |
| Call + parser/diagnostic | 14.834 s |
| Cold arm                 | 30.332 s |
| Cold group               | 30.546 s |
| Through durable closure  | 36.530 s |

The 180-second direct diagnostic target passed; the collection cap remained 300 seconds. Full application latency was not measured. Actual allocation was Vulkan, f16 KV, 8,192-token context, all 25/25 GPU layers, six threads and 1 GiB reserve. These numbers match BH, but do not prove the discarded outputs were identical.

The original AB01 question/key, eight full passages/order, exact frozen BF prompt/system/schema, greedy sampler, 128 thought tokens and 2,176 total-token allowance were unchanged. The original worker generated normally: 128 thought tokens reached the cap, two forced closing tokens and 140 visible envelope tokens totaled 270. The historical BD wire request was reconstructed; exact BF/BI request identity does not establish historical outbound-byte identity.

Whole closure preceded metadata inspection: **611 pins matched**, Node/postverifier/worker exits were **0/0/0**, pending requests and forced stops were zero, profiles were removed and no owned/native processes remained. Capture was disabled. This diagnostic locates a formatting predicate in BI; it establishes neither semantic correctness nor a repair.

See [manual.json](manual.json) and [observations.json](observations.json) for separate grades, fixed metadata and immutable evidence hashes.
