# Citation alias experiment: default off

`LOKLM_CITATION_ALIASES=1` opts into prompt-local labels such as `[S1]`. The production default remains canonical `[doc:<id>, chunk:<id>]` markers. Leaving the variable unset or setting it to `0` disables the experiment.

The experiment was not accepted as a production default after the `dev-8k-alias-plan` development trial. It repaired one previously observed wrong-chunk citation, but other answers still selected an unsupported passage or omitted attribution. A simpler identifier did not reliably solve passage selection.

| Development case | Observed outcome                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| dev-06           | Correct calculation and exact input passages `1:2` and `2:5`; the earlier approval-only citation was avoided.     |
| dev-01           | Correct amount, but cited introduction `1:1`; the supporting revenue passage `1:2` was supplied and left uncited. |
| dev-07           | Correct identifier, but no inline citation despite the supporting passage being supplied.                         |
| dev-11           | Correct calculation and supporting citation, but a lengthy derivation despite the requested single sentence.      |

The raw answers, supplied passages, build/source hashes and run configuration are in [raw.json](reports/dev-8k-alias-plan/raw.json); claim-level judgments are in [manual.json](reports/dev-8k-alias-plan/manual.json). These observations use a small synthetic development corpus, Qwen3.5-4B, an 8,192-token context and a 4 GiB GTX 1050 Ti. They are not held-out validation. Layer-plan reuse and thread defaults also changed in this run, so its latency differences cannot be attributed to aliases alone.

## What the adapter guarantees—and does not

The map contains only passages supplied to the current answer. It changes source headers, not source bodies or the question. Labels already present literally in input, titles, headings or history are reserved. Bundled and Ollama adapters translate recognized output labels back to the existing public canonical format; unknown labels remain literal. Historical canonical citations are retained.

An alias is a copying aid, not a claim verifier. A valid label proves that a passage was supplied; it does not prove that the passage supports the adjacent statement. No adapter can create an omitted citation safely merely by assigning the first retrieved source. The experiment does not change retrieval ranking, refusal thresholds or source selection.

The incremental decoder has focused coverage for chunk boundaries, retries, cancellation, code and link preservation. It uses bounded, conservative Markdown recognition rather than a complete Markdown parser. Those unit checks validate transformation behavior, not answer correctness. Follow-up decoder edge fixes and generic format/citation prompt reminders were written after the trial build was frozen; that native run must not be presented as validation of those later changes.

After those follow-up fixes, 133 tests passed across eight focused files: decoder, bundled/Ollama adapters, prompt formatting, tight context/history budgets and existing ask/provider regressions. Full `pnpm typecheck` passed. Forced scoped ESLint reported zero errors and four pre-existing unused-disable warnings in `LlamaService.ts`. These checks do not change the rejected/default-off decision or establish native answer quality for the follow-up changes.

The next production candidate uses canonical markers with the generic prompt refinements. Reconsidering alias defaults requires fresh answer-level evidence, including exact passage support and missing-citation rates, without fitting to held-out questions.
