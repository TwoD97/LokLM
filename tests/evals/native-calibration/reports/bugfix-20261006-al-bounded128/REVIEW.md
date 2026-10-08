# AL 128-thought diagnostic: one strict pass, one parser nonpass

**Both known AB cells completed native generation, but only AB01 produced a validated answer and passed the original criteria. AB02 was rejected with `answer` / `source_label`.** There were no timeouts, retries or unobserved cells. Production's thought cap remains 64; this evaluation-only copy used 128.

[Tracked observations](observations.json) preserve the exact validated final, fixed rejection codes, source order and safe counters. [Manual judgments](manual.json) distinguish semantic review from unavailable content. No hidden thoughts, private check, raw generation envelope, rejected prose or exact rejected label was inspected or retained here.

| Fixed order | Cell                     | Strict result                       | Native seconds | Validated final |
| ----------- | ------------------------ | ----------------------------------- | -------------: | --------------- |
| 1           | ab-fresh-01 / thought128 | Pass                                |        114.560 | Yes             |
| 2           | ab-fresh-02 / thought128 | Parser nonpass: answer/source_label |        144.275 | No              |

## Independent original-criteria review

**AB01 passes.** The compact framed sentence includes South's exact **19-day** interval with 2:2 and North's exact **14-day** interval with 1:1, both for NP-6 filters in campaign S8. Its lead limits uncertainty to what the supplied excerpts establish. It selects no governing winner and invents no nonapproval, supersession, chronology or global absence of an interval. Both requested alternatives, local attribution and short format are satisfied. Unlike AK01, no irrelevant heading/date units displace the North value. Retaining the original English sentence inside the German framing is a documented presentation tradeoff under the unchanged criteria.

**AB02 has no assessable semantic answer.** Generation ended normally with `stopGenerationTrigger`; JSON parsing succeeded and the external-line-break count was zero. The unchanged production parser then rejected `answer` with detail `source_label`. No validated final is available. The precise rejected label, current-limit values, source selection and authority reasoning cannot be inferred from the fixed code or output counters. A parser rejection is not evidence that the hidden answer was otherwise correct. The full eight original supplied passages, including base, amendment and proposal, remained present.

The aggregate is **1/2 strict passes**, with one parser nonpass and zero operational timeouts. Both cases were already known DEV. Their original questions, source text and grading criteria were unchanged; no new validation corpus was authored.

## Fixed treatment and observed runtime

The immutable input plan reconstructs the exact AK questions, all actual supplied passages in their recorded order, system text, prompts and v14 schemas. No directive was removed. Context repacking reproduced the app's prompt estimates of **1651/1589**, and this native run's exact prompt token counts **1532/1377** matched AK. The parser retained its 13056-character ordinary-answer limit. Reconstruction hashes identify these reproduced bundles; native prompt bytes were not originally logged by the app.

The only declared decoder change is the copied adapter's thought cap **64→128**. The same **2176 combined-token allowance** remains, so this reduces the maximum capacity available for the final response rather than expanding total output. The diagnostic used public Qwen3.5 auto reasoning, chunked prefill, compact JSON grammar, Vulkan, 8K context, q8 KV, 14 GPU layers, 6 threads, batch size 254, 1 GiB padding, temperature 0 and repetition penalty disabled. Both calls reached the 128-token thought budget and used two forced-closing tokens.

| Cell | Prefill tokens / batches | Thought | Forced closing | Constrained response | Combined |
| ---- | -----------------------: | ------: | -------------: | -------------------: | -------: |
| AB01 |                 1531 / 7 |     128 |              2 |                   89 |      219 |
| AB02 |                 1376 / 6 |     128 |              2 |                  165 |      295 |

Both parsed envelopes had a string check of 120 codepoints and zero line breaks outside JSON strings. These are fixed scalar observations; no check contents were retained. Constrained-response tokens include the private check and JSON syntax, not just user-visible prose.

The **180-second native deadline is not the app's 180-second request deadline**. It includes sequence clear, chunked prefill, thought/final sampling and helper cleanup, but excludes model loading, grammar/tokenization and app retrieval/handoffs. Model load took 15.694 seconds separately. Adding a prior approximate handoff cost would only produce an estimate; no end-to-end AL app timing was measured. The 15-second abort grace permits acknowledgement only, never extra accepted generation time.

The separate [AK app observations](../bugfix-20261006-ak-ab-replay/REVIEW.md) remain unchanged. This small direct diagnostic does not isolate a causal throughput effect, establish general quality or justify production promotion. In particular, AB02 still produced no publishable answer. No repair or second attempt was performed.

## Provenance and cleanup

The execution declaration froze at **2026-10-06T02:17:28.211Z**. The process started at **02:17:43.999Z**; cells ran from **02:18:04.047Z** to **02:22:22.942Z**. Postverification at **02:23:17.9770004Z** found all declared source/build/SDK/helper/input/model pins unchanged, disposed cleanup and no owned native process. Exit code 1 reflects the parser nonpass despite both native completions. Production remained on the AK build with its original 64-token cap.

- AK build manifest: `c10051ebfd1d15adfd6a8d0467c6abcf17227d07c52694d842f2df4a960f8669`.
- Input plan: `out/optimization-20261005/al-diagnostic-inputs.json`, SHA-256 `3f45c0c1eacd25e0f7c70a0033c8449afd936635806c8ea32c6d481d6d8308a8`.
- Declaration: `out/optimization-20261005/al-execution-declaration.json`, SHA-256 `c59b92d56f8830993f30f4a7c89a2c12ce5df92d99c74661f64236ea73e67309`.
- Postverification: `out/optimization-20261005/al-postverify.json`, SHA-256 `99c8139c91074aa81eb2ead402e5cde7596a20f33810bf982ff9817b817b1363`.
- Original local raw artifact: `out/optimization-20261005/al-bounded128-native-20261006/raw.json`, SHA-256 `583574b55f9c4f42fbedae38b725d80379611b805cb349fab8072a4f303e5167`.

These original artifacts are local generated files. The tracked review, manual judgments and allowlisted observations preserve the result; the latter also records the ten frozen diagnostic/helper source hashes. Report preparation verified those hashes without launching a model, changing production or editing the corpus or grading key.
