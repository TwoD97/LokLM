# AF rejection-detail diagnostic: no validated answer

**The one requested call completed native decoding but failed final validation: `answer` / `source_label`.** Native generation took 122.196 seconds and reached `stopGenerationTrigger` without cancellation. No final answer was retained, so the strict result is **0 of 1 passes**. This is a separately declared diagnostic of a known development failure, not a replacement for the failed AE cell or a fresh evaluation.

[Tracked safe observations](observations.json) preserve the fixed rejection categories, input source order, hashes and content-free counters. [Manual review](manual.json) records the operational nonpass while leaving semantic and citation correctness unassessed. Neither the exact offending source label nor its location or surrounding discarded text is known. The result must not be described as a particular bad ID, missing citation, fabricated fact or recovered correct answer.

| Requested cell        | Native seconds | Native stop           | Parser / detail       | Validated final |
| --------------------- | -------------: | --------------------- | --------------------- | --------------- |
| ab-fresh-02/thought64 |        122.196 | stopGenerationTrigger | answer / source_label | None            |

The call sampled 64 thought tokens and 178 constrained-response tokens; the two forced thought-closing tokens bring the combined count to 244. The constrained response was 430 characters. Exact prompt length was 1365 tokens, with recorded input/output token meters of 1366/242. These counters match the corresponding AE observation, but **do not prove identical discarded content**. No thought text/token array, private check, rejected prose, chat history or raw model response envelope was inspected or persisted.

## Treatment and comparison limits

The immutable AF cell is exactly equal to the prior AE64/case02 cell, including the original question, all eight actually supplied passages and order, lean system contract, user prompt, v11 schema and parsing limits. The decoding helper and lean contract retain their frozen AE hashes. The source change adds a fixed rejection-detail callback; it does not relax validation, repair citations, change the prompt/schema or add a fallback. The purpose is to identify a structural rejection category, not to retry until a quality pass.

AF is the first and only cell in a fresh native context. In AE, this case was second after `clearHistory` in the same loaded model/context. That difference was declared before execution in `af-execution-limitations.json`. AF is therefore a new observation under the same cell inputs, not a byte-for-byte reproduction of discarded AE output or evidence that instrumentation caused the result.

Configuration stayed Qwen3.5-4B Q4_K_M, public `thoughts:auto`, 64 ungrammared thought tokens followed by fresh grammar on the same sequence, Q8 KV, 8192 context, 14 GPU layers, 6 threads, batch 254, 1 GiB VRAM reserve, temperature 0, repeat penalty disabled and 2176 total generated tokens. There was one call, no adaptive retry and no second full prefill within the call. The 180-second deadline includes native prefill and both decoding phases, while reset/grammar/tokenization setup is excluded. The additional 15 seconds is cancellation acknowledgement grace, not accepted generation time. `visibleTokens` names constrained-response tokens, including the private check field, rather than final displayed-answer tokens; callback timings are not UI streaming or exact prefill measurements.

No new model-quality conclusion or production reasoning integration follows. The original [AE four-cell results](../bugfix-20261005-ae-lean-delayed-grammar/REVIEW.md) and [AC first-observation failures](../bugfix-20261005-ac-fresh-validation/REVIEW.md) remain unchanged. No new dataset was authored or evaluated for AF.

## Provenance

The execution declaration froze at 2026-10-06T00:09:19.396Z, with the context-order addendum at 00:09:41.938Z. Collection ran from 00:11:52.974Z to 00:14:14.468Z. Cleanup completed, the GPU was released, and the run reports unchanged fingerprints after completion. Reporting verified the exact AF/AE cell equality, unchanged configuration, and all five files hashed by the frozen declaration.

- Input plan: `out/optimization-20261005/af-diagnostic-inputs.json`, SHA-256 `fb7ca49cc6e2766cacf26e06ae967ad5de168bb2aaf29e9e5b3532e87c30d87e`.
- Execution declaration: `out/optimization-20261005/af-execution-declaration.json`, SHA-256 `c0b0285c89c5765f6c9724d6fe149a92937fc4d383936ef6e583c299be27ba73`.
- Limitation addendum: `out/optimization-20261005/af-execution-limitations.json`, SHA-256 `e94fc999b828ec6ce2808aa53bfe103de6719bdb0051013d2bfbd7b6470a4a33`.
- Runner SHA-256: `4b0baa6321c739b0046c7d300f9983f88985c7ef823afce891e58f1c41c913bf`; unchanged AE decoder SHA-256: `1a9597137e19f78e8ec857674cf5278a6b7b36c32aefd90047d8d464aadd60ec`.
- Instrumented build manifest SHA-256: `1a10b34abc5e3c1f9ad44bfc5a280d97bca500b71a4c565c2f3d99378fe60089`. This is a new instrumentation build, not the original AC build.

The local generated result is `out/optimization-20261005/af-rejection-detail-native-20261006-0012/raw.json`, SHA-256 `db96a3bbe5e456a785bb8cfe138a3968370603c957eb8a5caeb96347bb5cb1fc`. It is ignored by version control; this review, manual judgment and allowlisted observations preserve the diagnostic record in tracked form. Sealed fixtures, reference criteria and earlier observations were not modified.
