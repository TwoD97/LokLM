# K: separately authorized longer-window diagnostic

**The answer completed in 188.484 seconds: correct values, but incorrect source selection in its first paragraph.** This is a single known-case diagnostic with a 300-second deadline. It remains slower than the original 180-second target, cannot replace either prior timeout, and is not a passing regression result or a product deadline change.

The declaration `out/optimization-20261005/k-long-timing-declaration.json` was frozen at 2026-10-05T15:56:06.133Z before launch. It verified the exact K build, all previously frozen RAG/shared/diagnostic inputs, and source/build parity. Manifest SHA-256: `57fed58a7ec9a5042ace80607a0e5e8e4df6fc3f6fd0260c7fe8db3788f94f7e`. Worker SHA-256: `98618dec686a20f56a00879e498b34d902d718070927863973fbc55d7af38137`. Compiled bytes remained unchanged through exit. No schema, prompt, model, output allowance, sampler, corpus or retrieval option changed; only the diagnostic deadline increased. One attempt, zero retries, all eighteen source documents, default small-document expansion and no gold-source filtering were retained.

The final answer correctly gives four drills and five saws for 2031-06-01, explains the drill-limit change effective 2031-05-15, and preserves the unchanged saw limit. However, its first paragraph cites **1:1 and 4:4**. Passage 1:1 is an unrelated Neral export draft; passage 4:4 changes the drill limit and leaves the saw rule unchanged without stating its numeric value. The actual five-saw value is in **3:3**, which was supplied. The second paragraph correctly cites 3:3/4:4, but that does not make the first paragraph's unrelated citation valid. Strict judgment: semantic decision correct, source attribution partial/unsupported locally; not a full supported-answer pass. Program-generated valid markers establish membership and placement, not relevance or entailment.

| Content-free measurement                  |           Observation |
| ----------------------------------------- | --------------------: |
| Actual restored context / KV / GPU layers |       8192 / f16 / 14 |
| Output allowance                          |           2176 tokens |
| Grammar compilation / prompt-fit check    |             5 / 29 ms |
| Native prompt execution                   |             177940 ms |
| First text / non-whitespace callback      |              22455 ms |
| Last text / non-whitespace callback       |             176791 ms |
| Response characters / callbacks           |             770 / 343 |
| Public token-meter input / output         |     2473 / 344 tokens |
| Completion reason                         | stopGenerationTrigger |
| Parsed branch                             |              answered |
| Cancellation                              |                 false |

The generation terminated after 344 output tokens, far below its 2176-token allowance; it did not demonstrate an unbounded-output loop in this observation. The shorter K diagnostic had reached 329 output tokens when its deadline cancelled generation. Those lengths are consistent with ordinary generation cost near the time limit, but partial output was not retained, so identical prefixes or closeness to completion in the earlier run cannot be proved. Callback arrival is not an exact prefill boundary. The 5 ms grammar compilation measurement does not isolate per-token grammar filtering cost from inference and scheduling. No hidden check, thought text or partial JSON was retained/read.

Startup took 42.313 seconds and indexing 10.585 seconds. Sampled peak GPU use was 3537 MiB, which is not a hard maximum guarantee. The app produced one completed terminal; the owned process exited 0 and GPU was released immediately afterward. No additional diagnostic or schema A/B was launched. Original [J02](../bugfix-20261005-j-known-reasoning-continuation-1/REVIEW.md) and [K 180-second](../bugfix-20261005-k-timing-j02/REVIEW.md) failures remain unchanged.

[manual.json](manual.json) contains the tracked assessment. `raw.json` and `review.json` are local generated evidence/auxiliary artifacts. Raw SHA-256: `a4c82e9952fa42a61dadb796f1c29b32b96aaabda6b80e3f52e948a33b6f79f1`.
