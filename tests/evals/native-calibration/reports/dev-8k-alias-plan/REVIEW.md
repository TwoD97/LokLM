# Citation-label and layer-plan development experiment

All twelve development questions were evaluated, followed by repeats of cases 06 and 03. This is development data, not held-out validation. The run enables both prompt-local citation labels and reuse of a previously successful GPU layer plan; it cannot isolate the effect of either change on latency.

**Seven of nine answerable first-pass cases have correct answers and complete supporting passage citations. All three missing-fact/conflict cases remain safe.** The comparison's attribution defect disappears, but citation regressions appear on other questions. This experiment fails the no-new-grounding-regressions gate and does not demonstrate a net grounding improvement. Citation labels remain disabled by default.

| Case                   | First-pass manual review                                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 revenue             | Correct 48,260 EUR, but cites ledger introduction 1:1 rather than the supplied revenue table 1:2. **Unsupported passage attribution.**                    |
| 02 inspections         | Supported: 184 with exact operations table 1:2.                                                                                                           |
| 03 approval            | Supported: requested ISO date 2026-03-09 with exact approval passage 2:4.                                                                                 |
| 04 sample mass         | Supported: Neral 18.4 kg, localized as 18,4 kg, with PDF table 6:9.                                                                                       |
| 05 accepted trays      | Supported: 27 + 35 = 62 with PDF table 6:9.                                                                                                               |
| 06 revenue comparison  | Supported: 53,780 - 48,260 = 5,520 EUR, citing both exact input passages 2:5 and 1:2.                                                                     |
| 07 batch identifier    | Correct MSX-417 but **no inline citation**; draft A passage 3:6 was supplied.                                                                             |
| 08 upper bound         | Supported: return value 4 with function passage 5:8.                                                                                                      |
| 09 missing officer     | Safe limitation: no officer is identified; no invented person.                                                                                            |
| 10 conflicting drafts  | Safe: preserves both ISO dates with exact sources 3:6 and 4:7; does not invent a definitive deadline. Extra explanatory sentence lacks a direct citation. |
| 11 lower bound         | Supported: return value 0 and correctly ordered calculation, with function passage 5:8. Much longer than the requested one short sentence.                |
| 12 missing temperature | Safe limitation: no outdoor measurements. Omits PDF citation 6:9, which earlier runs supplied.                                                            |

The two answerable failures are attribution failures, not wrong numerical or identifier facts. Case 12 is separately counted as safe abstention despite its citation omission. Case 10's second sentence has support in the preceding source but incomplete marker placement. Keeping these dimensions separate avoids presenting safe refusals as fully cited answers.

Both repeats remain fully supported and match their first-pass answers. No observation has a timeout, stream error, missing terminal event, or invented document/chunk ID. All recorded allocations are 8,192-token context with 14 of 33 chat layers on the GPU. Model objects/hashes, fixture hash, and extracted chunk objects match the preceding 8K balanced run. The GPU is still the GTX 1050 Ti with 4,096 MiB; the reserve and thread controls are set to their defaults. The sampled whole-card peak is 3,177 MiB, not isolated application allocation or a guaranteed maximum between samples.

For the twelve first-pass observations, conventional median time to first token event is 37.283 s, first non-whitespace text 37.7395 s, and terminal event 52.564 s. Startup is 44.559 s; indexing is 10.075 s and ends with embeddings resident. These timings include the actual observed handoffs. Case order, model residency, prompt format, and layer-plan reuse differ from earlier runs; aggregate differences do not establish a citation-label speed effect.

| Repeated case | First-pass visible / final | Repeat visible / final |
| ------------- | -------------------------: | ---------------------: |
| 06 comparison |          30.875 / 59.387 s |      20.547 / 46.801 s |
| 03 approval   |          36.239 / 49.068 s |      18.648 / 31.093 s |

Generation length remains important: case 11 reaches visible text in 39.653 s, but its unrequested multi-step explanation takes 111.358 s to finish, versus 78.815 s for the concise 8K balanced answer. Earlier first text alone does not establish a faster completed answer.

The decoder fixes for literal link backticks and plain comparisons were made in source during this run and were **not part of the frozen compiled application measured here**. They require their own targeted regression checks; they do not change these recorded native answers. `manual.json` contains all fourteen independent semantic reviews, while `review.json` records mechanical evidence and separates first-pass observations from repeats.
