# AO original regressions: two strict passes

**Both original held-out regression questions pass the unchanged criteria on this known DEV replay.** Each completed once within the 180-second app deadline, with correct local citations and the requested one-short-sentence format. No timeout, retry or unobserved case occurred in this group.

[Safe observations](observations.json) preserve the exact final answers, supplied source order and runtime counters; [manual judgments](manual.json) record independent claim-level review. This group covers **2 of AO's 10 requested known cases**. Other groups and the earlier AN AB3 remain separate observations.

| Order | Case       | Strict result | App seconds | Native seconds |
| ----- | ---------- | ------------- | ----------: | -------------: |
| 1     | heldout-10 | Pass          |     130.811 |        120.125 |
| 2     | heldout-06 | Pass          |     163.067 |        145.502 |

## Original-criteria assessment

**Heldout-10 passes.** Actual supplied draft B 4:7 gives **2027-05-15** and draft A 3:6 gives **2027-05-08** for the same Orvo dispatch. The final quotes both exact deadline sentences with their own canonical references and correct rendered ISO dates. Its compact framing limits uncertainty to the supplied excerpts, without selecting a winner, treating absent signatures as proof of nonapproval, inventing supersession/chronology or asserting that no final deadline exists anywhere. It meets the requested short format and omits irrelevant retention arithmetic. Original English wording in one quote remains the existing presentation tradeoff.

**Heldout-06 passes.** The actual supplied tables establish planned 2025 revenue of **78165 GBP** and recorded 2024 revenue of **73410 GBP**, giving **4755 GBP**. The single German sentence preserves the planned/actual distinction and both years; canonical references attach to the correct value-bearing tables 2:5 and 1:2. It excludes reserve balances and does not claim the planned target was achieved. The question does not require repeating both input amounts.

The full six-document original corpus was eligible and all nine indexed passages were actually supplied for both questions. These outcomes do not rely on gold-source filtering or missing-evidence repair. Questions, fixtures, reference checks and prior strict interpretation remain unchanged. The earlier successful and failed runs are not overwritten.

## Runtime, scope and provenance

AO retains the exact AN v16 prompt/schema/128 allowance, with the separately declared first-stop-trigger residue correction. This is a new build observation; no causal quality or timing claim is made from comparing separate runs.

Both calls observed `typed-comparison-v16`, a concise 40-unit catalog, active bounded128 on the main route, q8_0 KV, 8192 context, 14 GPU layers, temperature 0, repeat penalty disabled and maxTokens 2176. They ended with normal `stopGenerationTrigger` and settled completed terminals. No unsupported-wrapper, setup-failed or grammar-fallback status appeared. Worker start markers reported compact JSON; both successfully parsed envelopes had `capture.externalLineBreaks=0`.

| Case       | Prompt tokens | Prefill tokens / batches | Thought | Forced closing | Constrained response | Combined |
| ---------- | ------------: | -----------------------: | ------: | -------------: | -------------------: | -------: |
| heldout-10 |          2015 |                 2014 / 8 |     128 |              2 |                   92 |      222 |
| heldout-06 |          2028 |                 2027 / 8 |     128 |              2 |                  148 |      278 |

Counters contain no hidden text. Constrained-response tokens include private check and JSON syntax, not only displayed prose. App times include retrieval/preparation; native times are a subset. The arithmetic case finished with 16.933 seconds of app-deadline margin, so this observation is not a general latency guarantee.

Declaration freeze: **2026-10-06T03:04:15.916Z**. Collection: **03:04:42.719Z–03:10:31.497Z**. Postverification: **03:11:22.380Z**. At this group boundary, all 419 source and 112 compiled pins, model/fixture/harness bytes matched; observer disposal had zero errors/drops/pending replies, and no owned native/Playwright process or capture artifact remained. The runner exited 0 and `safeToContinue=true`. Trace, screenshot and video capture were off. Later authorized groups have their own declarations and cleanup evidence.

- Build manifest: `564eb3cd028a8f4f7c51ce4f3f6cf7f08ea88de96af16fd5bd05819b9a3ff7c5`.
- Compiled worker: `2b5751b66659b31cc6307e52bd3764d92d681e44b6f8154956b0c4890ea0eb35`.
- Declaration: `out/optimization-20261005/ao-original-replay-execution-declaration.json`, SHA-256 `365cfaf6a6824eb15eb665f47792b70276043eec84869bef78aab2058657b45b`.
- Postverification: `out/optimization-20261005/ao-original-replay-postverify.json`, SHA-256 `7d60acf411a9fa5c597c9bcd35acee9169d1cb4be672440bbb0a9fa9c144fd8d`.
- Original local [raw observations](raw.json), SHA-256 `53141ebfcbb8d9816d45ff884929d35936d467131a385846d3702c4481ebcb71`.

The raw/log/declaration files are generated local artifacts. Tracked review, manual judgments and allowlisted observations preserve this result. No private thoughts/checks/envelopes were inspected; report preparation made no production, harness, fixture or grading changes and launched no model or new validation set.
