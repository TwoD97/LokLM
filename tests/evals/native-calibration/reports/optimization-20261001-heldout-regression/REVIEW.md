# October optimization: reused held-out regression

All twelve questions ran once on the compiled application with real local inference. These are the original held-out cases, now previously seen and reused after earlier results informed development. This is a regression check, not a new untouched evaluation or a causal estimate of accuracy improvements. No answer-driven prompt or retrieval tuning was applied during this run.

**All nine answerable cases have correct facts and exact supporting passage citations. Two of three uncertainty cases preserve safe limits. The conflicting-deadline case again makes an unsupported definitive claim. The successful test harness result means execution completed; it does not mean all answers passed quality review.**

| Case                   | Independent answer and passage review                                                               | Outcome         |
| ---------------------- | --------------------------------------------------------------------------------------------------- | --------------- |
| 01 revenue             | Correct GBP 73,410 for 2024, in German; exact table 1:2.                                            | Supported       |
| 02 inspections         | Correct 156 planned for 2025; exact plan table 2:5.                                                 | Supported       |
| 03 approval            | Requested ISO date 2025-02-06; exact approval passage 2:4.                                          | Supported       |
| 04 PDF mass            | Correct Teral 31.6 kg and survey date 2027-02-23; exact PDF table 6:9.                              | Supported       |
| 05 PDF total           | Correct 18 + 29 = 47 accepted trays, in German; exact PDF table 6:9.                                | Supported       |
| 06 comparison          | Correct GBP 78,165 minus GBP 73,410 = GBP 4,755; both exact tables 2:5 and 1:2.                     | Supported       |
| 07 identifier          | Correct ORV-862; exact draft A 3:6.                                                                 | Supported       |
| 08 code multiplication | Correct return value 60 seconds, in German; complete function 5:8.                                  | Supported       |
| 09 missing officer     | Says supplied context does not identify the CEO; no person invented or inline citation claimed.     | Safe abstention |
| 10 conflict            | Selects draft B's date as definitive, despite both conflicting unapproved drafts being supplied.    | Unsupported     |
| 11 code early return   | Correct return value 0 seconds; complete function 5:8.                                              | Supported       |
| 12 missing temperature | Accurately says provided context contains no measured outdoor temperature for Luvon; exact PDF 6:9. | Safe abstention |

Case 10 says: “Die endgültige Versandfrist für Orvo ist 2027-05-15”. Its explanation cites only draft B (4:7) and treats the lack of approval or supersession as a reason to accept that date. The supplied draft A (3:6) gives 2027-05-08; both drafts have the same issue date and neither establishes authority. Passage 4:7 supports what draft B says, but cannot support a definitive resolution of the conflict. This is a material unsupported-authority failure, not merely a missing citation, an ISO-format issue or an incomplete list of alternatives. It repeats the critical failure class from the original frozen run despite the later generic conflict instructions.

Case 06's former wrong-passage attribution is absent in this observation: the answer cites both revenue tables. Case 12 does not repeat today's DEV answer's unsupported stronger description that the report does not measure temperatures. It remains limited to absence from the supplied context. All requested numeric facts, units, identifiers, code results and non-conflicting dates are correct. Responses use the requested language and one sentence, although several compound explanations are longer than necessary. Case 09's terminal source array is provided context, not inline citations that the answer did not make.

## Runtime and comparison limits

The requested and actual answer context was 8,192 tokens throughout, using q4_0 KV and 14 of 33 chat layers on the GPU, including startup. This is partial GPU offload. Default threads/reserve, query-vector caching and guarded layer-plan reuse were enabled. Reranking, query expansion, routing, whole-document fallback, citation aliases and source-marker footers were disabled. There were no repeats, inference timeouts or stream error events. The retained application log records an initial plan-cache miss followed by twelve validated post-retrieval cache hits and no allocation fallback.

Conventional medians are **39.091 s to the first token event**, **39.311 s to first visible text**, and **58.5305 s to the terminal event**. Startup was 42.383 s and indexing 9.173 s. Sampled whole-card usage peaked at 3,513 MiB on the 4,096 MiB GPU, leaving a minimum observed 583 MiB; desktop use is included and short peaks may be missed. Sampled free system RAM reached 2.542 GiB.

The original `heldout-8k-final` had eight of nine fully supported answerable responses and two safe uncertainty responses. Its comparison answer used an incorrect ledger introduction citation, and its conflict answer also invented definitive authority. Its first-visible median was 39.887 s and terminal median 59.503 s. The current observation improves comparison attribution, while the critical conflict failure remains. These timing differences do not isolate any optimization or establish a general speedup: application/dependencies and runtime memory state differ, and the original first two answering allocations used q8_0 before switching to q4_0.

Unlike the DEV comparison, all six source-file hashes and complete extracted chunk objects match the original frozen run. The manifest and both GGUF model hashes also match. The recorded RAG, prompt, citation and model-worker source hashes match today's DEV run. Main/preload/shared-document code and the complete compiled application differ due to subsequent workflow guards, so these two October runs must not be described as using an identical full build.

All eight compiled JavaScript artifacts under main/preload, including shared chunks and workers, matched their own before-run fingerprints after cleanup. The raw answers and supplied passages are preserved. `manual.json` contains the independent per-case verdicts; `mechanical-review.json` contains mechanical checks and timings. This small synthetic sample does not establish broad document accuracy, robust conflict resolution, OCR/chart quality, long-conversation behavior or guaranteed GPU headroom.
