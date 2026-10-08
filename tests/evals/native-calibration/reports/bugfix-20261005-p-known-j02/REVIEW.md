# P: retrieval defects corrected; one-case answer still timed out

**P produced no completed answer within 180 seconds.** The one requested actual-app case ended at 180.179 seconds with a cancelled terminal and interruption notice. This is 0/1 usable answers, an operational failure rather than a factual or citation verdict. There was no completed generation from which to establish a quotation-parser outcome. No retry, direct replay or continuation was authorized or run after this gate.

The retrieval changes did correct the independently identified defects in this observation. L decomposed the response instruction “Belege beide Grenzen.” into its own retrieval query and embedding. P retained the original complete question for answer generation but searched only the substantive question. The unrelated second search disappeared: one arm, one query-embedding miss and 4096 cache bytes instead of two arms, two misses and 8192 bytes. The observed retrieval stage was 94 ms (L: 181 ms); this tiny single-case observation does not establish a general speed improvement.

L also promoted unrelated filenames when the question's ISO date overlapped their standalone `01`/`06` tokens. Their adjusted score factor was 1.375, combining a 1.25 title boost with 1.1 recency preference. P excludes purely numeric tokens from that optional title preference while retaining numbers in lexical/dense retrieval. Both unrelated filenames lose the title boost. The approved amendment now remains adjacent to the base rule in the actual supplied context:

| Passage                     | L fused rank | L adjusted rank | L supplied rank | P fused rank | P adjusted rank | P supplied rank |
| --------------------------- | -----------: | --------------: | --------------: | -----------: | --------------: | --------------: |
| Base rule 3:3               |            1 |               1 |               1 |            1 |               1 |               1 |
| Approved amendment 4:4      |            2 |               4 |               4 |            2 |               2 |               2 |
| Unrelated draft 1:1         |           11 |               2 |               2 |           12 |              12 |          absent |
| Unrelated gauge reading 6:6 |           17 |               3 |               3 |           16 |              16 |          absent |

The trace supports these ranking and work-reduction findings directly. Better ranking is not proof that the model will apply the amendment correctly, and the timeout provides no such evidence. All eighteen documents remained eligible; no gold-source filtering, topic-specific keyword rule, semantic threshold change or top-K reduction was used. Default small-document expansion was enabled. Eleven passages were supplied, with 3:3 and 4:4 first and second. Retrieval trace order with sibling expansion and final supplied order are recorded separately in the comparison artifact.

P was frozen at 2026-10-05T17:24:17.561Z in `out/optimization-20261005/p-production-freeze.json`. Runtime changes relative to L were the generic trailing response/citation-directive and numeric-title preference fixes in `heuristics.ts`, plus the worker's current-language/system-prompt preservation across conversation restoration. The freeze verifies L's bilingual checked systems, comparison instructions and complete grammar/helper source hashes unchanged. Production retained `typed-comparison-v5`; M/N thought or evidence-first scaffolding was not integrated. This is a grouped retrieval/language-fix actual-app gate, not an isolated causal comparison.

| Content-free measurement                     |      P observation |
| -------------------------------------------- | -----------------: |
| Actual restored context / KV / GPU layers    |   8192 / q8_0 / 14 |
| Prompt estimate / output allowance           | 2694 / 2176 tokens |
| Grammar compilation / exact prompt-fit check |          5 / 29 ms |
| Native execution before cancellation         |          169698 ms |
| First / last response callback               |  22626 / 169232 ms |
| Response characters / callbacks              |          822 / 310 |
| Input / output tokens                        |         2447 / 311 |
| Native completion reason                     |    none; cancelled |
| End-to-end request time                      |          180179 ms |

Startup used f16, but the actual question restored q8_0; L's question used f16. Timing comparisons must therefore include this resource confound as well as the changed retrieved context. The 2176-token allowance was not exhausted at cancellation; 311 generated output tokens do not establish why completion took longer, whether the output would eventually be valid, or what the proposed answer was. No model check, partial JSON, thought text or incomplete answer was retained/read. The callback timings are internal main-response events, not user-visible answer arrival or an exact prefill boundary.

Startup took 42.456 seconds and indexing 10.588 seconds. Sampled peak GPU use was 3447 MiB, not a guaranteed peak bound. The owned process exited 1, compiled fingerprints remained unchanged, and GPU was released immediately. The preserved localized interruption message is a status note, not an answer. The original L, M, N and N2 outcomes remain unchanged.

Build manifest SHA-256: `04391ed8ac77501b69a69a5e341020e634f7b62cf5846a1a5fb85228cec0682c`. Worker SHA-256: `c29fc8e4777e542ae22179b0386d743e4cdeeb8c85dab2a46495d9af1d3c4b41`. Source/build correspondence was verified before launch and after exit. [manual.json](manual.json) records the strict assessment; local generated `raw.json`, `retrieval.log` and `review.json` retain the authorized evidence. The baseline and detailed ranking comparison are local generated artifacts under `out/optimization-20261005/`.

Raw SHA-256: `2cb77ebdedddfacd696743117890b4f5864940942c210c7f31bb00ecdcc44b76`. Retrieval trace SHA-256: `9ee0e9e99b97df7bed673c940f0b161662b461c8bc1a2da47e18f611f4f0d8e1`. Detailed comparison: `out/optimization-20261005/p-retrieval-comparison.json`.
