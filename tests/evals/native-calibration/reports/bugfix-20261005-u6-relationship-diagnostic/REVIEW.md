# U6: concentrated classification does not fix the full-context refusal

**The production-relevant full-context inventory cell still chose the wrong insufficient-evidence outcome.** Its selected-passage counterpart chose compatible, demonstrating a context-sensitive failure rather than a validated application fix. All six fixed cells completed once with valid bounded JSON. Correct parsing is not semantic success, and no final user answer was generated or graded.

| Known case / input variant | Outcome      | Selected source IDs  | Assessment                                                              | Native time |
| -------------------------- | ------------ | -------------------- | ----------------------------------------------------------------------- | ----------: |
| 06/selected                | compatible   | 11:11, 12:12         | Correct outcome and relevant source selection                           |    30.399 s |
| 06/full-fed                | insufficient | 11:11, 12:12         | Incorrect insufficient outcome despite complete different-time evidence |    39.710 s |
| 10/selected                | insufficient | 18:19                | Correct outcome and relevant source selection                           |    26.882 s |
| 10/full-fed                | insufficient | 18:19, 6:6, 1:1, 2:2 | Correct missing-fact outcome but unnecessary unrelated source selection |    46.261 s |
| 12/selected                | insufficient | 13:15                | Correct outcome and relevant source selection                           |    30.728 s |
| 12/full-fed                | insufficient | 13:14, 13:15         | Correct missing-fact outcome; same-record header unnecessary            |    36.434 s |

For case 06, both input variants include the original **11:11** and **12:12** inventory passages: 12 at 08:00 before deliveries/withdrawals versus 17 at 18:00 afterward. Different explicitly stated observation times make the counts compatible. The classifier returns that judgment with only the two previously selected passages, but again returns insufficient when all eleven actual supplied passages are present, while still selecting those same two correct identities. The shorter general classification task therefore did not repair the error under full context.

Cases 10 and 12 test genuine missing information. Case 10 provides a flow rate without duration or total; case 12's table supplies no electrical measurement. All four cells correctly choose insufficient. However, **10/full-fed additionally selects unrelated Edrin tank 6:6 and Neral deadline drafts 1:1/2:2** beside the relevant Pemnor 18:19. That is a source-selection/relevance failure even though the outcome is correct. In 12/full-fed, the header 13:14 is unnecessary contextual material from the same record; table 13:15 supplies the actual missing-measurement evidence. No irrelevant identities were removed or retargeted.

This was a **six-cell diagnostic over three already known questions**, not six independent evaluation cases, not fresh evidence and not a production intervention. Selected variants use actual earlier final citation selections, not gold/reference source pairs; full variants use the entire earlier citation-event-fed catalog in its original order. Original questions and passage bytes are unchanged. No prior answer, outcome, check or reference answer was supplied to the classifier. The new task uses only a compact system instruction and a schema with `outcome` plus one to four IDs drawn from **all input passages**. It asks for no rationale or private check and does not repair outputs.

The fixed sequence was 06 selected/full, 10 selected/full, 12 selected/full, all frozen before the first call. Input catalogs contained 2/11, 1/11 and 1/11 passages respectively. Compared with the app's general answer contract, this changes task instructions, context scope in selected cells, schema and output allowance together. It cannot isolate which difference caused selected-context success, nor justify a subset-only production override that might miss counterevidence elsewhere.

The direct public SDK used the same model bytes, an asserted **8192-token context, q4_0 key/value cache, 14 GPU layers, six threads**, 1 GiB VRAM padding, temperature 0, repeatPenalty:false and the nonthinking wrapper with thought budget zero. Native output was limited to **80 tokens**, versus the app's 2176; per-cell timeout remained 180 seconds. Session history and sequence were cleared before every cell; the same loaded model/context remained resident across cells. Every call completed with `stopGenerationTrigger`, no cancellation, retry, repair or grammar fallback. Native execution was 26.882–46.261 seconds; these timings exclude model load/retrieval/handoffs and are not app response-time estimates. The high end of observed output was 77/80 tokens, still complete.

| Cell        | Input tokens | Output tokens | First / last native text callback |
| ----------- | -----------: | ------------: | --------------------------------: |
| 06/selected |          343 |            56 |                   5133 / 28247 ms |
| 06/full-fed |         1148 |            57 |                  11994 / 37279 ms |
| 10/selected |          261 |            45 |                   6553 / 24603 ms |
| 10/full-fed |         1091 |            77 |                  10034 / 43943 ms |
| 12/selected |          276 |            45 |                  10285 / 28562 ms |
| 12/full-fed |         1101 |            57 |                  10115 / 34209 ms |

Only validated enum outcomes/source IDs and content-free timing/token/parse metadata were persisted. No private check, hidden thought segments, explanation, generated answer text or raw envelope was saved. The strict parser rejects duplicate keys including escaped duplicates, unknown fields/IDs and invalid selection bounds. Twenty-two parser/privacy assertions and an independent read-only runner review preceded execution. The runner verifies source/model/build fingerprints, bounds abort acknowledgement, disposes its owned native objects and preserves unattempted cells on a fatal cleanup/admission failure; none occurred here.

Plan: local generated `out/optimization-20261005/u6-relationship-plan-frozen.json`, frozen **2026-10-05T19:37:37.501Z**; SHA-256 `d3f2d80d8e8b6d065c759e5c0240bced7b305eed4313530b6b7fae94b97f9bc0`. Raw: local generated `out/optimization-20261005/u6-relationship-native/raw.json`; SHA-256 `500acd60376c04c7877766973e1258bc181d8a3a8b0197fcce283ad31cc1e356`. Build manifest SHA-256 `1498fc86875da5f27f01adfd6d205facc7a0840ee89a1769a005d4850bdd9de7`. Model SHA-256 `00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4`. All fingerprints remained unchanged after exit; the owned process exited 0 with clean disposal and released the GPU. The earlier one-cell U plan was prepared but never executed. Production sources were not edited by this diagnostic, and the new sealed three-case corpus was not opened or run by the executing agent.

[manual.json](manual.json) keeps all six classifications and the separate outcome/source-relevance judgments. [T's actual-app failure](../bugfix-20261005-t-known-r06/REVIEW.md) and [S's known regression](../bugfix-20261005-s-known-reasoning/REVIEW.md) remain unchanged. **No reliable full-context classifier correction was demonstrated.**
