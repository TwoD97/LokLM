# Final development review

The frozen candidate answered all twelve development questions once, with canonical source markers, query-vector caching and GPU-layer-plan reuse enabled, default thread/reserve policies, an 8K request, and reranking disabled. This run has no repeated questions. Development observations informed earlier changes, so these twelve cases are **not held-out evidence**.

**Eight of nine answerable cases have correct answers with complete supporting passage citations. All three missing-fact/conflict cases are safe.** No requested numerical result, date, identifier, unit, or code return value is incorrect. One known exact-passage attribution failure remains: case 06's correct 5,520 EUR difference cites the plan introduction rather than its revenue table.

| Case                               | Independent semantic review                                                                                                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 recorded revenue                | Supported: 48,260 EUR, exact table 1:2.                                                                                                                                      |
| 02 completed inspections           | Supported: 184, exact table 1:2.                                                                                                                                             |
| 03 approval date                   | Supported: requested ISO 2026-03-09, exact approval 2:4.                                                                                                                     |
| 04 PDF sample mass                 | Supported: Neral 18.4 kg, exact PDF table 6:9.                                                                                                                               |
| 05 PDF accepted-tray sum           | Supported: 27 + 35 = 62, exact PDF table 6:9.                                                                                                                                |
| 06 cross-source revenue comparison | **Unsupported passage attribution:** correct 5,520 EUR; 1:2 supports the 2025 input, but 2:4 has no 2026 revenue figure. Correct input passage 2:5 was supplied but uncited. |
| 07 draft identifier                | Supported: MSX-417, exact draft A 3:6.                                                                                                                                       |
| 08 upper-bound code result         | Supported: 4 slots, exact function 5:8.                                                                                                                                      |
| 09 missing officer                 | Safe limitation; no person invented.                                                                                                                                         |
| 10 conflicting drafts              | Safe: both ISO dates and exact sources 3:6/4:7; explicitly says neither establishes definitive authority.                                                                    |
| 11 lower-bound code result         | Supported: 0, exact function 5:8; short result instead of the prior long derivation.                                                                                         |
| 12 missing outdoor temperature     | Safe limitation with explicit supporting PDF citation 6:9.                                                                                                                   |

The alias experiment's missing identifier citation, wrong revenue passage, and omitted missing-temperature citation are absent. Its corrected comparison attribution is not retained: canonical markers still select wrong passage 2:4 for that input. This failure prevents calling all answers grounded or describing marker validity as semantic verification. Citation chips and document-level coverage would miss it.

The native baseline's incorrect lower-bound result is corrected. Requested one-sentence answers are respected in this final run, although the compound conflict sentence remains long and one code answer includes harmless bold emphasis. No new critical numeric/date/abstention failure appears on these fixed development cases. This is a bounded diagnostic improvement, not proof of general accuracy.

All twelve observations recorded terminal events; none timed out or emitted an inference error. All recorded allocations are 8,192-token context and 14 of 33 chat layers on the GPU. Model objects/hashes, the fixture hash, and the extracted chunk objects match earlier development runs. Whole-card GPU usage peaked at a sampled 3,235 MiB on the 4,096 MiB GTX 1050 Ti; sampling can miss brief peaks and includes the desktop. A Chromium GPU-process state warning after the last answer and before cleanup is distinct from a native inference OOM; no corresponding failed query was observed.

Conventional median first-token-event time is **37.884 s**, first visible non-whitespace text **37.8845 s**, and terminal-event time **56.447 s**. Startup is 43.831 s; indexing is 9.065 s and ends with embeddings resident. The baseline's recorded twelve-case completion median was 89.162 s, with missing completion-event capture on four baseline queries. Context, GPU/KV allocation, resource policy, prompt, order, and runtime state differ across those runs; the difference is descriptive and does not isolate one optimization.

`manual.json` contains all twelve independent answer/source reviews, and `review.json` records mechanical evidence and measured times. The same compiled build and configuration are frozen for one document-disjoint held-out run. Held-out results will be reported without retuning on them.
