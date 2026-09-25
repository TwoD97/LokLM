# Frozen held-out review

This is the first and only run of these twelve held-out questions on the frozen final candidate. Model objects/hashes and the complete recorded application source/build hash map match `dev-8k-final`. Configuration also matches: canonical citations, default resource policies, 8K context request, query-vector and GPU-layer-plan reuse enabled, no reranker, query expansion, routing, or whole-document fallback. No repeats or case filtering were used. The manifest and six source files passed the existing held-out hash lock.

**Eight of nine answerable cases have correct answers with complete supporting passage citations. Two of three missing-fact/conflict cases are safe. The unresolved-conflict case produces an unsupported definitive deadline.** These results do not pass a requirement that conflicting evidence always elicit safe uncertainty.

| Case                           | Independent semantic review                                                                                                                                          |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 recorded revenue            | Supported: 73,410 GBP for 2024, exact table 1:2.                                                                                                                     |
| 02 planned inspections         | Supported: 156 for 2025, exact planning table 2:5.                                                                                                                   |
| 03 approval                    | Supported: requested ISO date 2025-02-06, exact approval 2:4.                                                                                                        |
| 04 PDF mass                    | Supported: Teral 31.6 kg, exact PDF table 6:9.                                                                                                                       |
| 05 PDF sum                     | Supported total 47 and true Teral count 18, exact PDF table 6:9; German connective is awkward and recorded as a wording defect.                                      |
| 06 cross-source comparison     | **Unsupported passage attribution:** correct 4,755 GBP, but cites ledger introduction 1:1 rather than recorded-revenue table 1:2. Plan table 2:5 is cited correctly. |
| 07 identifier                  | Supported: ORV-862, exact draft A 3:6.                                                                                                                               |
| 08 positive code branch        | Supported: 60 seconds, exact function 5:8.                                                                                                                           |
| 09 missing executive           | Safe limitation; no person invented.                                                                                                                                 |
| 10 conflicting drafts          | **Unsupported definitive answer:** selects 2027-05-15 from B despite supplied conflicting A date 2027-05-08 and no approval/supersession authority.                  |
| 11 early-return code branch    | Supported: 0 seconds for a negative attempt, exact function 5:8.                                                                                                     |
| 12 missing outdoor temperature | Safe limitation, exact PDF statement 6:9 cited.                                                                                                                      |

Case 10 is a substantive safety-of-uncertainty failure, not a formatting defect or retrieval miss. Draft B was supplied first and draft A second. Both explicitly lack approval/supersession statements. The answer cites only B and treats its lack of authority as a reason to call B's date definitive. The date exists in evidence, but its asserted definitive status does not. All source-marker IDs are valid, illustrating why marker validity alone is insufficient.

The comparison's precise passage-attribution weakness transfers from DEV, although the wrong input changes: final DEV cites the wrong planning passage, while held-out cites the wrong ledger passage. Both exact input tables survived retrieval and packing. This is a generation/attribution failure, not absent evidence.

Case 05 says that Teral had 18 and the combined total is 47 with an awkward omitted connective. Both values and the cited PDF are correct. The review records the clarity defect rather than construing an unstated claim that Luvon alone had 47. No other answerable numerical/date/unit error or false refusal was observed in this small sample.

All twelve queries recorded terminal events, with no inference timeout or stream error. All actual allocations are 8,192-token context and 14 of 33 GPU layers. The sampled whole-card peak is 3,271 MiB on the 4,096 MiB GTX 1050 Ti; this includes desktop use and is not a guaranteed instantaneous maximum. Startup is 43.532 s and indexing 9.047 s, ending with embeddings resident.

Conventional median time to first token event and first visible text is **39.887 s**; median terminal-event time is **59.503 s**. The slower approval answer remains included (60.372 s visible, 75.447 s final). These twelve observations do not establish a stable latency distribution or general hardware speedup.

The sources, entities, values, and questions are document-disjoint from DEV, but the six-document corpus and question categories are structurally parallel synthetic examples. This checks narrow transfer, not arbitrary-library generalization, large-corpus retrieval selectivity, scanned PDFs, complicated code workspaces, or long conversations. It is not a calibrated production accuracy percentage.

`manual.json` contains all twelve independent reviews and `review.json` their mechanical evidence. Any conflict-policy change made after observing this failure is **post-held-out development**. A separate `conflict-regression` corpus may check unresolved versus explicitly authorized revisions, but cannot retroactively turn this frozen held-out failure into a pass or supply a second untouched held-out claim.
