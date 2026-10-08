# Q: synthesized quotation rejected in the actual app

**Q produced no completed answer in its one requested known-case gate.** Generation finished before the fixed three-minute limit, but the strict quotation resolver rejected it with `quote_missing`. The application returned an error and the localized failure note after **125.344 seconds**. This is **0/1 usable answers**, not a timeout or a successful factual answer. There was no retry; the new four-case transfer set remains unrun.

The new test-only observer identified the concrete mismatch without retaining the model's check, rejected answer text, raw envelope or hidden segments. Its two bounded evidence strings were:

- Rejected: “Mitglieder dürfen höchstens 4 Bohrmaschinen gleichzeitig leihen.” This sentence is absent from all eleven supplied passages. The base rule 3:3 actually says 3 drills; amendment 4:4 says the drill limit rises from 3 to 4. Q synthesized a plausible updated sentence and presented it as a literal quotation. This is not a whitespace or length mismatch and must not be repaired by changing source words.
- Accepted independently: “Mitglieder dürfen höchstens 5 Sägen gleichzeitig leihen.” This resolves uniquely to the actual base passage 3:3.

The two relevant passages remained first and second in the supplied context, exactly as in P. All 18 documents were eligible, and default small-document expansion supplied 11 passages. No reference-source filtering or corpus-specific rule was used. The rejected first evidence value is consistent with the amended drill limit, but rejected ordinary answer text was deliberately not captured; the evidence string alone does not establish a complete correct answer, date application, or attribution. No semantic success is inferred.

Q was frozen at 2026-10-05T17:55:18.213Z. It retained P's retrieval and worker language fixes, changed native ordinary-record order to evidence-before-text, clarified that evidence contains literal source text, and added a conditional instruction to check a rule amendment's authority/effective applicability while retaining unchanged base clauses. Logs confirm `typed-comparison-v6`, 8192 context tokens, 2176 output allowance, temperature 0 and repeatPenalty: false. Parser algorithms, quote/work/display bounds and inference defaults were unchanged. This grouped treatment does not isolate the effect of ordering from instructions.

| Content-free measurement                     |                        Q observation |
| -------------------------------------------- | -----------------------------------: |
| Actual restored context / KV / GPU layers    |                     8192 / q8_0 / 14 |
| Prompt estimate / output allowance           |                   2807 / 2176 tokens |
| Grammar compilation / exact prompt-fit check |                            5 / 29 ms |
| Native execution                             |                            114942 ms |
| First / last response callback               |                    22751 / 113087 ms |
| Response characters / callbacks              |                            511 / 192 |
| Input / output tokens                        |                           2513 / 194 |
| Native completion reason                     | stopGenerationTrigger; not cancelled |
| End-to-end request time                      |                            125344 ms |

Internal response callbacks are not user-visible answer arrival or exact prefill timing. Startup used f16; the actual question restored q8_0. Startup took 42.468 seconds, indexing 11.191 seconds, and sampled GPU use peaked at 3455 MiB. These observations do not establish a general speed improvement.

The synthetic observer was explicitly enabled only in the owned test profile, installed before model-worker creation, and matched the exact checked schema and RPC. It captured one completed response with **1 ms sanitizer overhead**, 0 observer errors, 0 dropped rows and 0 pending requests. Post-observation settlement took 5 ms and is recorded separately from the native observation. Its no-model Electron probe had verified unchanged IPC forwarding and restoration. No production observer hooks or raw logging were added. An incomplete generation would not expose partial evidence through this observer.

The owned process exited 1, and GPU was released immediately. Compiled fingerprints were unchanged after the run. Production helper SHA-256 remains the blind proposed Q contract `3361b10f072002badbaf4ca36814db1f7c0d8ab7a17eba0b2c3186f389d7fd33`, frozen before the transfer fixture contents were released. Build manifest SHA-256: `794d9eb7b159e125cdc02cf6c48c465208bcfa2aaa97aece4998880c0170d905`. Worker SHA-256: `c29fc8e4777e542ae22179b0386d743e4cdeeb8c85dab2a46495d9af1d3c4b41`.

[manual.json](manual.json) records the strict assessment. Local generated `raw.json`, `app.log`, `retrieval.log` and `review.json` preserve the authorized evidence. The immutable declaration is the local generated `out/optimization-20261005/q-production-freeze.json`; evidence-only classification is `out/optimization-20261005/q-evidence-classification.json`. Raw SHA-256: `b93cf900fadac646f662941f263fa9652796dad91b9bc2aec76438e66c5dae94`.
