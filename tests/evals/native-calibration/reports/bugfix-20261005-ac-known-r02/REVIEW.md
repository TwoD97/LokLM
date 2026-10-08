# AC current-rule gate: one strict pass

This is one known development case, collected once through the actual app with all 18 source documents, default whole-document expansion, a 180-second deadline, and no retries. The complete answer passed independent review by organizer_store and root. The previous AB false refusal remains preserved in its separate report.

| Case                  | Requested / observed | Strict result | Total     | Actual query allocation             |
| --------------------- | -------------------- | ------------- | --------- | ----------------------------------- |
| reasoning-reserved-02 | 1 / 1                | Pass          | 131.048 s | 8192 tokens, q8_0 KV, 14 GPU layers |

The answer correctly applies the approved May 15 amendment to the drill limit (4) while retaining the base saw limit (5) for June 1. Its parenthetical describes the effective increase, not a new document-approval date. Both actual supplied passages, 3:3 and 4:4, support the complete coherent answer and have local canonical citations. No false refusal, unrelated source, or unsupported condition was added.

## Candidate and limits

AC combines a generic field-by-field applicability instruction with a bounded memory-planning change: when the heuristic selects q4, try q8 at the same requested context before the existing q4 fallback. Schema, catalog, renderer, sampler, output allowance, and the deadline are unchanged. This observation does not isolate either change's causal effect and is not fresh validation.

The final build manifest is `a153fccc912c4ce974aa80d588a04cd3c8359c29940098418d1b44b51fd11af3`; compiled worker is `6f2c6abf27484f50fe3afa1d6af5330f278cfe276b8a7420daf2ad4ef02ede5d`. The runtime freeze pins the actual worker and its shared dependencies, including modelMemory.ts. Final provenance confirms the compiled tree unchanged and current sources matching the build. Exact full/concise schema hashes and unchanged observer bytes were checked against the AB no-model proofs.

The checked route was `typed-comparison-v11`, full mode, ordinary answered output, temperature 0, repeat penalty disabled, and maxTokens 2176. Native generation used 2844 input and 194 output tokens; native time was 120.590 s. First callback was 25.921 s after native invocation; it is not user-visible answer latency. First visible output was 131.047 s. The bounded synthetic observer reported zero errors, drops, or pending requests and retained no private check text or raw response envelope.

## Evidence and next collection

[Manual judgments](manual.json) are tracked. [Raw app observations](raw.json), [derived review](review.json), and [metrics](metrics.json) are local generated artifacts. Raw SHA-256: `8dfb9b1b13b7a920b54e962b82af209e5bd41515d68d58d955735c7a8cedc1b3`.

The separately declared original10 then original06 pair was authorized only after this strict pass, clean process closure, and source/build verification. See [the original gate](../bugfix-20261005-ac-original-gate/REVIEW.md) when completed. Later controls remain conditional; the new sealed set was then unrun and unseen by production contributors. It was authored after AB freeze but before AC, so no claim of post-AC authoring is made.

Subsequent validation is preserved separately: [the sealed three-case collection](../bugfix-20261005-ac-fresh-validation/REVIEW.md) produced only **1/3 strict passes**, including one critical false current/base value. The known-case passes here do not establish general reliability.
