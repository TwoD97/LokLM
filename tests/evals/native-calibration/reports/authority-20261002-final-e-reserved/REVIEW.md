# Frozen E: independently reserved authority and scope cases

All eight questions ran once after the explicit E freeze. Independent assistant-agent review finds **2/5 fully supported answerable responses and 1/3 complete, grounded abstention responses**. The other five fail exact attribution or the requested factual/relationship judgment. Valid source IDs and correctly copied values do not make those answers correct. The corpus is small and synthetic; these are observed case outcomes, not a population accuracy estimate.

| Case                         | Complete outcome                 | Material finding                                                                                          |
| ---------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 01 conflicting counts        | **Incorrect**                    | Adds overlapping 54/57 counts into definitive 111, despite the same 60-unit serial cohort                 |
| 02 approved replacement      | **Incorrect attribution**        | Correct active 6 and replacement decision; amendment effective-date/supersession claim cites old rule 3:3 |
| 03 unapproved later proposal | Supported                        | Current 84 EUR remains effective; 96 EUR draft is unvoted and nonbinding; exact 5:5/6:6                   |
| 04 seasonal scope            | **Incorrect**                    | Correct 06:30/08:15 times, but falsely calls nonoverlapping winter/summer schedules contradictory         |
| 05 equivalent units          | **Incorrect**                    | Correctly quotes 90 seconds and 1.5 minutes, but falsely says the durations disagree                      |
| 06 missing degree            | Safe complete factual abstention | Does not invent a qualification; exact absence statement 11:11; verbose/awkward wording                   |
| 07 archived code             | **Incorrect calculation**        | Correct deployed uncertainty and A=8, but claims B=10 when the supplied code returns 9                    |
| 08 agreement                 | Supported                        | Daily 02:10 UTC and 45 days confirmed by policy 14:14 and audit 15:15                                     |

Case 01 is unsupported aggregation, not merely an omitted warning. Both signed reports describe lot K9, serials 4100–4159, on the same date; they disagree on 54 versus57 and state that consolidation is undocumented. The answer claims 111 definitively passed and uses the identical cohort as its reason to add. Both input citations are genuine, but neither supports treating overlapping reports as separate populations. The invented total even exceeds the 60 unique serial numbers.

Case 02 selects the authorized rule correctly. Its separate failure is exact attribution: the sentence asserting the amendment's April 15 effective date and supersession cites 3:3, which contains the old 4-tool rule. The subsequent 4:4 citation correctly supports the next binding-status/power-tool sentence; it does not change the preceding wrong marker. This distinction prevents a correct authority decision from masking a citation defect.

Cases 04 and 05 fail the explicit consistency questions despite correct numbers and citations. Different seasonal windows do not conflict; 90 seconds equals 1.5 minutes. Case 07 likewise copies real code but mistakes the maximum allowed value 10 for the returned value 9. Its correct refusal to select a deployed archive is preserved as a successful authority decision, while the requested per-copy calculation remains wrong. It therefore cannot count as a complete abstention answer.

A second independent assistant agent reviewed 01, 03 and 07 against the actual supplied passages and agreed. These are assistant judgments, not human-expert adjudication or the local model's self-assessment. All requested source documents were supplied in these failed cases; the failures are not explained by their absence from the prompt. Unknown-ID checks and regexes alone would miss the central defects.

## Freeze and runtime

The original reserved manifest and 15 sources were withheld from tuning agents until the explicit E freeze, then published at 10:48:56 UTC with all 16 original datafile hashes unchanged. The lock seal is `e18ae81aeeb0ff40b588c78824db44e9605b317ee50651a68c9d8e8d29008963`. All 17 files including the lock survived a separate Git `core.autocrlf=true` staging/checkout proof. No original or reserved result led to a production edit after freeze. Any later experiment on these observed cases is development evidence, not another untouched reserved claim.

The run used the fixed E manifest `826073a904228b18730fe401c2734f3b0d6e35c6fee99ffcd186a9a0944c553b`, the existing 4B Q4_K_M model, actual 8192 context and 14 GPU layers. All profiles record LITE; KV precision varies between q4_0, q8_0 and f16. Assessment, reranking, multi-query expansion, routing and whole-document fallback were disabled. There were no repeats or warm reruns, the per-question limit was 300 seconds, and the isolated vault's idle lock was disabled. The normal application security default was unchanged.

All eight terminals completed; no question timed out or failed transport. Median total latency was 118.0875 seconds and median first-visible text 42.5875 seconds. Startup was 45.753 seconds and indexing 11.213 seconds, outside those request totals. The outer script exited 0, and the exact E source/compiled verification passed after the run. Execution success does not imply answer-quality success.

This fresh result does not support a broad authority, reasoning or citation-reliability improvement. It is also not directly comparable as an accuracy rate to the older, easier corpus. The deterministic runtime fixes remain independently tested; the assessment feature remains off by default. Raw output and every failure are retained unchanged alongside `manual.json` and the derived `review.json`.
