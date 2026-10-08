# AB: known reasoning controls — incomplete collection

Of six predeclared questions, four were attempted once: two strict passes, one false refusal, and one operational timeout. The last two questions were not attempted. The [original conflict/arithmetic gate](../bugfix-20261005-ab-original-gate/REVIEW.md) passed both questions, but these controls do **not** support an unqualified successful candidate claim. [manual.json](manual.json) contains independent-review judgments.

| Requested case                                   | Observed outcome             | Seconds | Actual KV | Result                  |
| ------------------------------------------------ | ---------------------------- | ------: | --------- | ----------------------- |
| 02, current limits after partial amendment       | False refusal                | 103.512 | q4_0      | comparison / unresolved |
| 05, current contribution and unapproved proposal | Strict pass                  | 133.472 | q4_0      | answered                |
| 06, observations at different times              | Strict pass                  | 125.922 | q4_0      | comparison / compatible |
| 09, sum of disjoint populations                  | Timeout; no completed answer | 180.147 | q4_0      | No parsed result        |
| 11, average rate                                 | Unattempted                  |       — | —         | —                       |
| 12, missing electrical measurement               | Unattempted                  |       — | —         | —                       |

Case 02 had both required passages at the first two actual prompt positions. The base rule supplies five saws; the approved, already-effective amendment raises only drills to four and preserves the other provisions. AB quoted both accurately but incorrectly declared the answer unresolved and did not produce the requested current limits. This is a semantic false refusal and incomplete answer, not retrieval loss or invalid citation syntax. The exact question is in `reasoning-reserved-20261005.json`, case `reasoning-reserved-02`; sources are `fixtures/r26-03.md` and `fixtures/r26-04.md`. Runtime logs confirm **unresolved**, not insufficient.

Case 05 correctly gives current 72 EUR versus proposed 81 EUR, including the explicitly documented lack of a vote and absence of revocation. Its negative authority statements are sourced facts rather than inferences from missing documentation. Case 06 correctly presents the same cabinet at 08:00 before activity and 18:00 after it, with 12 and 17 sensors respectively; there is no invented different location or irrelevant source.

Case 09 supplied both required population passages but timed out with one cancelled terminal and no substantive final answer. Its meaning cannot be graded from hidden intermediate output. Content-free counters show 2,822 input and 237 output tokens, 162.374 seconds of native generation, first text callback 37.652 seconds, last 161.889 seconds, 554 response characters, cancellation true and no completion reason. These internal callbacks are not visible answer streaming or exact prefill measures. The overall 180-second deadline includes retrieval/model handoff; it was not increased. No retry was made.

All 18 source documents remained eligible, with default whole-document expansion, one attempt per question, zero retries and the bounded synthetic observer. Every observed call used the full v11 branch family with conciseUnitCount 0 and no catalog fallback. Actual allocations were 8K/q4_0/14 GPU layers; previous q8/f16 observations are not isolated prompt/precision comparisons. The observer recorded valid structural shape and fixed metadata only, with no private check, raw response envelope or hidden segments retained or inspected. It therefore cannot supply an exact rejected/intermediate model record retrospectively.

The harness stopped naturally on 09. No live call was killed to create an administrative boundary; the requested denominator remains six. The owned process exited 1 as expected for the timeout. At closure, compiled build unchanged was **true** and current sources matched was **true**. Transfer and fresh groups were never launched. Subsequent candidate work does not replace these observations.

Declaration: local generated `out/optimization-20261005/ab-reasoning-controls-declaration.json`, 2026-10-05T22:25:13.374Z. AB production freeze: 2026-10-05T22:12:33.572Z. Manifest SHA-256: `9dc36ace28a08e9c35471109250989fd283b246cd9ff3a1497b74f51b904a009`; worker SHA-256: `4e7a15e0847e377a6c1275157e773ba8ca8ceedb8fbf5b995dc1129ef515c2ce`. Raw SHA-256: `72a10b5e61d8c4737cc417be24f0b3419addc5c9e786e16f851afe80a7d9c6b4`.

This review and manual judgments are tracked; `raw.json`, `review.json`, [metrics.json](metrics.json), `app.log` and `retrieval.log` are local generated artifacts. The separate newly authored transfer set remains unrun and its content undisclosed to production authors; no fresh accuracy claim is made.
