# 4K development baseline: independent review

All 12 observed answers were read against the **actual supplied passages**, not just reference strings. Seven of nine answerable cases were correctly answered with supporting citations. The three unavailable/conflicting-fact cases were handled safely. Two substantive failures remain; these small synthetic counts are not a general accuracy estimate.

| Case | Independent verdict      | Evidence                                                                                                                         |
| ---- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 01   | Supported                | Recorded 2025 revenue: 48,260 EUR; correct ledger passage.                                                                       |
| 02   | Supported                | 184 completed inspections, German answer over English source.                                                                    |
| 03   | Supported                | Approval date 2026-03-09, English answer over German source.                                                                     |
| 04   | Supported                | PDF table: Neral sample mass 18.4 kg, correct row and unit.                                                                      |
| 05   | Supported                | 27 + 35 = 62 accepted trays, excluding rejected trays.                                                                           |
| 06   | **Unsupported citation** | Correct 5,520 EUR difference, but cites Selka shipping memo 4:7 instead of revenue passages 1:2 and 2:5.                         |
| 07   | Supported                | Exact MSX-417 identifier, correctly attributed to draft A.                                                                       |
| 08   | Supported                | `reserveSlots(13,5)` returns 4, correct function cited.                                                                          |
| 09   | Safe abstention          | Does not invent the absent CFO's name.                                                                                           |
| 10   | Safe abstention          | Preserves both conflicting deadlines and declines to invent authority. Final explanatory sentence lacks its own citation marker. |
| 11   | **Incorrect result**     | Computes remaining capacity as 0 but then claims return value 4. Actual `Math.min(4,0)` is 0. Correct function was supplied.     |
| 12   | Safe abstention          | Explicitly absent outdoor temperature; does not substitute cabinet setting 7°C.                                                  |

Case 06 uses a valid supplied citation ID, but that passage does not support the claim. Case 11 contains the expected regex `0` as an intermediate value while giving the wrong final answer. Both demonstrate why mechanical matching cannot certify factual grounding.

The conflict hypothesis did not fail: the answer acknowledged both dates, correct sources, and lack of approval/supersession. No new answerability threshold follows from these three abstention examples. Small-formatting issues (bold result in case 08, citation completeness in case 10) are distinct from the two substantive failures.

## Measured resource behavior

- NVIDIA GeForce GTX 1050 Ti, 4,096 MiB total. Baseline whole-GPU usage was 1,590 MiB; sampled peak was 3,552 MiB. These are whole-device measurements, not isolated application memory.
- All 12 queries recorded actual 4,096 context and 15/33 chat-model GPU layers. The model was partially offloaded, not fully GPU-resident.
- Chat model: `Qwen3.5-4B-Q4_K_M.gguf`; embedder: `Qwen3-Embedding-0.6B-Q8_0.gguf`. Exact hashes and dirty-source hashes are retained in `raw.json` and `review.json`.
- Startup: 40.638 s. Indexing: 43.381 s. First-token-event median: 62.193 s; maximum: 70.457 s. Observed invoke-completion median: 89.162 s; maximum: 132.883 s. Medians average the two central observations. All include the measured request path and GPU handoffs.
- No observed error events or timeouts. Four rows (05, 06, 10, 12) lacked the final `done` event before the original harness unsubscribed; native worker logs report completion. Their answers were graded from captured tokens and citation events. Exact final-event latency is unconfirmed for those rows. The harness was corrected for subsequent runs; baseline files remain unchanged.
- The first token event was whitespace-only in cases 04, 05, and 10. Baseline TTFT is therefore **first token event**, not consistently first visible text. Subsequent harness runs record first visible text separately.

All six documents and the PDF table extracted correctly. The corpus has only nine chunks. Cases 01–06 supplied all nine, so correct answers can mask poor ranking/selectivity. For example, decisive chunks ranked seventh in cases 02 and 03. This run measures a lean retrieval path with reranking, generated multi-query, routing, and whole-document fallback explicitly disabled; it does not test summary/inventory routes or larger-library retrieval quality. The observed decomposition behavior is still part of this baseline.

`manual.json` contains per-answer reasoning. `review.json` retains mechanical flags alongside those verdicts. There is one run per case, so percentile summaries are descriptive and must not be presented as stable tail latency or a paired treatment result.
