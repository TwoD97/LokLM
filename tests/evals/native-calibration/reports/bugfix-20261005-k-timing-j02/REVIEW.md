# K: one-case native timing diagnostic

**The single attempt timed out at 180.280 seconds without a completed answer.** This separate diagnostic revisits known case `reasoning-reserved-02` to measure native execution. It does not replace [J02's original timeout](../bugfix-20261005-j-known-reasoning-continuation-1/REVIEW.md), contribute a replacement score, or constitute a fresh quality evaluation. No additional calls were launched after the owned process exited 1.

K changes only content-free worker telemetry. Freeze `out/optimization-20261005/k-timing-freeze.json` verified all twelve J-fingerprinted RAG/shared production modules remained byte-identical. The manifest SHA-256 is `57fed58a7ec9a5042ace80607a0e5e8e4df6fc3f6fd0260c7fe8db3788f94f7e`; worker SHA-256 is `98618dec686a20f56a00879e498b34d902d718070927863973fbc55d7af38137`. Current sources matched the build before launch; compiled bytes remained unchanged through exit. The exact freeze was recorded at 2026-10-05T15:48:26.343Z.

All eighteen source documents were imported, normal small-document expansion was enabled, and no gold-source filtering was used. One attempt, zero retries, the same 180-second deadline, default resources, 8192 context, temperature 0, repetition penalty disabled, `typed-comparison-v4`, and output allowance 2176 were retained. The existing harness enables `LOKLM_RETRIEVAL_TRACE=1`. Both relevant 3:3/4:4 passages were actually supplied. The actual restored context was **8192/f16/14 GPU layers**.

| Content-free measurement                   | Observation |
| ------------------------------------------ | ----------: |
| Grammar compilation                        |        5 ms |
| Prompt-fit check                           |       27 ms |
| Native prompt execution                    |   169692 ms |
| First text / first non-whitespace callback |    22413 ms |
| Last text / last non-whitespace callback   |   165729 ms |
| Response characters / callbacks            |   738 / 320 |
| Public token-meter input / output counts   |  2473 / 329 |
| Native completion reason                   |        null |
| Cancelled                                  |        true |

Callback times are relative to native prompt invocation, **not exact prefill boundaries**. The timing shows that native generation emitted text and continued making progress; it was not entirely stuck before its first response. Grammar compilation and fit checks were small in this observation. It does **not** isolate per-token grammar filtering cost from model inference, native scheduling or resource effects, prove that output was close to completion, or show whether the eventual answer would have been correct. No partial JSON, generated check, source-bearing response or hidden reasoning was retained/read. There was no completed native diagnostic, parsed answer or parser rejection to grade.

Startup took 42.448 seconds, indexing 10.573 seconds and retrieval 0.174 seconds. Sampled peak GPU use was 3447 MiB; sampling is not a hard peak guarantee. The first-visible-answer metric is null because the structured answer never completed, even though internal text callback counts were nonzero. The app emitted one cancelled terminal with its interruption note and shut down cleanly. GPU was released before the next decision.

The result supports investigating generation cost and structured output length. A fixed-output schema-cost comparison would require separately frozen prompts/outputs, matched settings, explicit run order and identical observed output before making a narrow timing claim. No such comparison or production grammar change was performed here.

[manual.json](manual.json) contains the tracked assessment. `raw.json` and `review.json` are local generated artifacts. Raw SHA-256: `f3ed9ebf05dfd25c3c80f01ce4c5033e06c34be4a68dae705ccda6fe23857128`.
