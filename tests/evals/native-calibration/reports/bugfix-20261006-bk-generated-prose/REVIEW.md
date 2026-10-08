# BK generated-prose diagnostic — semantic NONPASS

Run: **2026-10-06**. Independent review: **2026-10-07**.

The single BK01 attempt completed normally and the executed **v30 parser admitted a final answer**, but strict and product acceptance remain **NONPASS**. The answer calls the reported intervals binding even though neither note establishes binding applicability. The fixed uncertainty lead and later documentary qualification do not support that claim. There was one attempt, zero retries, and the other 12 original cases remain unattempted.

The exact admitted answer was:

> Aus den bereitgestellten Textstellen geht keine eindeutige Antwort hervor: Das verbindliche Wartungsintervall für die NP-6-Filter der Kampagne S8 beträgt laut Notizen Nord und Süd je 14 bzw. 19 Tage, wobei die Notizen Nord und Süd keine Freigabeunterschrift oder Vorrang gegenüber der anderen Notiz belegen. [doc:2, chunk:2] [doc:1, chunk:1]

Both required values (Nord 14 days, Süd 19 days), their attribution and the NP-6/S8 scope pass. The shared local citation pair covers both actual value-bearing notes. German and brief single-sentence format also pass. However, **“Das verbindliche Wartungsintervall … beträgt … je 14 bzw. 19 Tage”** overstates the applicability of those values, so semantic correctness and support for every cited claim fail.

The phrase about what the notes do not document stays documentary: **“keine Freigabeunterschrift oder Vorrang … belegen”** is not graded as a global assertion that approval never occurred or no priority exists. This distinguishes the remaining binding-status error from earlier absence-of-approval errors. The original AB01 question and strict grading key were unchanged.

| Measurement             | Observed |
| ----------------------- | -------: |
| Model load              | 14.889 s |
| Native generation       | 16.444 s |
| Direct call             | 16.470 s |
| Call + parser           | 16.478 s |
| Cold arm                | 31.821 s |
| Cold group              | 32.055 s |
| Through durable closure | 37.811 s |

The 180-second direct diagnostic target passed separately; the collection cap remained 300 seconds. Full application latency was not measured. Actual allocation was Qwen3.5-2B-Q4_K_M on Vulkan, f16 KV, an 8,192-token context, **25/25 GPU layers**, six threads and 1 GiB reserve.

The executed build was **ab6efeb7356791c56abd36ae6e49b403d2752500e68314d6c55da3ed37e78b78**. The original eight full passages/order and exact BF/BJ prompt, system prompt, JSON schema and request options were unchanged. The new v30 admission uses the separately tested generated-prose formatter; exact source matchers remain unchanged. The obsolete v29 display observer was omitted. This was a new inference, with no retrospective parsing or grade replacement. Exact request equality does **not** establish BJ/BK output identity.

The existing ordinary main route observed **noThink: true**, **boundedReasoning: not_requested** and default JSON whitespace, with temperature 0, repeat penalty disabled and 2,176 maximum tokens. The bounded-thought field was omitted. Actual thought tokens and the exact prepared-wrapper count were not exported; token-meter deltas were 1,740 input and 228 output. This route differs from the bounded route, so no pure cap-ablation or historical failure-cause claim follows.

Whole closure preceded grading: **629 pins matched**, Node/Electron/worker/postverifier exits were **0/0/0/0**, pending requests and forced stops were zero, no owned/native processes remained, and the profile was removed. Capture was disabled. The report includes only the safe admitted answer and fixed metadata; no raw envelope, rejected body, private check or thought text. Closure is bound to the executed snapshot, without interpreting later source changes as evidence about this run.

No default model, route or other setting changed. BH, BI and BJ remain separate historical nonpasses. See [manual.json](manual.json) and [observations.json](observations.json) for passing subgrades, the decisive failure and immutable evidence hashes.
