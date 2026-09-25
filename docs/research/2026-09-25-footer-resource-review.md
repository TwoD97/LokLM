# Paired DEV resource review — 2026-09-25

The narrower allocation key worked across changing KV precision without changing the 8,192-token context, 14 GPU layers, six inference threads, or 1,024 MiB native reserve. The paired comparison covers only the two four-case DEV runs; later gates have separate resource sections below. Source-marker footers remain an opt-in experiment, default off. Citation aliases were off in all reviewed runs.

## Provenance and isolation

Runs: [control](../../tests/evals/native-calibration/reports/dev-20260925-footer-control/raw.json) (08:19:15–08:24:39 UTC) and [footer on](../../tests/evals/native-calibration/reports/dev-20260925-footer-on/raw.json) (08:24:54–08:29:57 UTC). Both used fresh isolated vaults, the same case order (`dev-06`, `dev-03`, `dev-07`, `dev-11`), one repetition, and identical model, manifest, imported-document, and all 23 tracked source/compiled hashes. The only recorded configuration difference was `sourceMarkerFooters`.

Compiled SHA-256 identities:

- Main: `d2d5fecb41e5e647bed400007a671b2bc6e13dd6f8f2f5246184baea603ab191`
- Worker: `1dad60a70f27288a7c6aaa36d3cd045864b4fe354704f3a58d6844999949c467`
- Preload: `07c5b3adf8249abc7d028803cf26640418795c2f3234119f36610d53a28fedd3`

## Allocation and memory

Both [control log](../../tests/evals/native-calibration/reports/dev-20260925-footer-control/app.log) and [footer log](../../tests/evals/native-calibration/reports/dev-20260925-footer-on/app.log) record Vulkan, `maxThreads=6`, `cpuMathCores=6`, and 1,073,741,824-byte padding. Every answer retained 8,192 tokens and 14 of 33 model layers on GPU; this is partial GPU offload, not CPU-only inference or full GPU residency.

| Measurement                            |           Control |         Footer on |
| -------------------------------------- | ----------------: | ----------------: |
| Initial automatic fit to ready         |          38.135 s |          36.442 s |
| Four query restorations, hint to ready |   10.592–11.046 s |   10.603–11.775 s |
| Startup / indexing                     | 59.142 / 11.138 s | 47.472 / 10.115 s |
| Physical GPU peak / total              | 3,392 / 4,096 MiB | 3,429 / 4,096 MiB |
| Minimum sampled physical GPU headroom  |           704 MiB |           667 MiB |
| Minimum sampled free system RAM        |         3.078 GiB |         4.504 GiB |
| GPU samples                            |               214 |               200 |

Control startup used Q4 KV, then query restorations selected Q8 and F16 while all four logged a layer-plan cache hit and current-memory revalidation. The footer run used F16 throughout and also logged four hits. There were no allocation rejection/fallback messages, stream errors, or timeouts in either run. This directly validates reuse across changed KV preference; these two arms do not measure the narrower key against the old implementation.

After indexing, only the embedder was resident; after each question, only chat was resident. Reranking stayed unloaded. Query-vector cache counts matched exactly: four misses, zero hits, four entries/16,384 bytes, no pending or coalesced requests. The first question used the already-resident embedder; later questions included its reload. No repeated-query cache benefit is mixed into this comparison.

## Prompt cost and timing

Retrieval arms, native scores, final retrieval order, and actually supplied chunk IDs/order matched exactly between arms. Footers did not displace evidence in these cases. Actual evaluated tokens and request timing were:

| Case   | Input tokens, off → on | Output tokens, off → on | Total seconds, off → on | First visible seconds, off → on |
| ------ | ---------------------: | ----------------------: | ----------------------: | ------------------------------: |
| dev-06 |          1,943 → 2,090 |                 73 → 74 |         76.180 → 71.453 |                 35.995 → 35.057 |
| dev-03 |          1,800 → 1,933 |                 37 → 37 |         63.089 → 57.414 |                 46.824 → 41.590 |
| dev-07 |          2,119 → 2,267 |                 30 → 30 |         57.389 → 57.823 |                 44.849 → 43.943 |
| dev-11 |          2,123 → 2,271 |                 31 → 31 |         55.930 → 58.245 |                 42.482 → 44.999 |

The 133–148 additional input tokens are the observed prompt cost. These timings do not establish a footer speed benefit: system RAM pressure differed, control dev-06 used Q8 versus F16, and the second run followed the first with potentially warmer filesystem caches. Startup duration includes more than model fitting. Sampling every 1.5 seconds can miss short memory peaks; native VRAM accounting and physical `nvidia-smi` totals are different measurements. An unchanged native reserve does not guarantee that much physical desktop-wide headroom.

This resource review does not certify answer support. Exact passage attribution, completeness, conflicting facts, and requested format require the separate manual reviews. Four matched synthetic DEV cases are a diagnostic sample, not representative accuracy; they omit dev-01's prior wrong-introductory-passage failure and missing-fact abstention.

## Separate gate: four conflict regressions

[Raw run](../../tests/evals/native-calibration/reports/conflict-20260925-footer-on/raw.json) and [log](../../tests/evals/native-calibration/reports/conflict-20260925-footer-on/app.log), 08:30:15–08:35:55 UTC. All four questions completed with terminal events, no stream errors, and no timeouts. This uses the existing post-held-out conflict-regression corpus, not the DEV corpus or a new unseen test. Its latency is not pooled with the paired comparison.

All 23 tracked source/compiled hashes and both model hashes match the paired arms. Footers were on, aliases off, and the same resource settings remained active. Startup selected F16; questions 01–04 selected Q8, Q4, Q4, and Q8 respectively. Every question retained 8,192 tokens and 14 GPU layers. The worker logged six inference threads, the unchanged 1,024 MiB reserve, and four positive layer-plan hits with current-memory revalidation. Restorations took 10.213–10.737 seconds; there were no allocation rejection or fallback messages.

Physical GPU use peaked at 3,293/4,096 MiB, leaving 803 MiB of sampled headroom across 225 samples. Minimum sampled free system RAM was 3.888 GiB. Startup and indexing took 47.279 and 9.121 seconds respectively; these are descriptive observations for this separate corpus. The post-index snapshot had only the embedder resident; each post-answer snapshot had only chat resident, with reranking still unloaded. The same sampling and native-versus-physical memory-accounting limitations apply.

## Separate gate: eight remaining DEV cases

[Raw run](../../tests/evals/native-calibration/reports/dev-20260925-footer-coverage/raw.json) and [log](../../tests/evals/native-calibration/reports/dev-20260925-footer-coverage/app.log), 08:36:19–08:46:01 UTC. All eight questions completed with terminal events, no stream errors, and no timeouts. These are the remaining cases from the same DEV manifest, in order `dev-01`, `dev-02`, `dev-04`, `dev-05`, `dev-08`, `dev-09`, `dev-10`, `dev-12`; they are not a new held-out sample or a matched latency control.

All 23 tracked source/compiled hashes, both model hashes, and the DEV manifest hash match the paired arms. Footers remained on and aliases off. Startup selected Q8; the eight questions selected Q4, Q4, Q4, Q4, Q8, Q4, Q8, and Q4. All retained 8,192 tokens, 14 GPU layers, six inference threads, and the unchanged 1,024 MiB reserve. All eight restorations logged a positive layer-plan hit and current-memory revalidation, taking 10.087–10.752 seconds. There were no allocation rejection or fallback messages.

Physical GPU use peaked at 3,451/4,096 MiB, leaving 645 MiB of sampled headroom across 385 samples. Minimum sampled free system RAM was 3.386 GiB. Startup and indexing took 46.383 and 10.100 seconds; these descriptive values are kept separate from the paired four-case comparison. Residency snapshots again show the embedder alone after indexing and chat alone after every answer, with reranking unloaded. The query-vector cache recorded eight misses, zero hits, eight entries/32,768 bytes, and no pending or coalesced requests. This run adds coverage of the earlier omitted DEV cases; its semantic outcomes belong to its separate manual review.

Across these four recorded runs, all 20 question-time restorations hit the positive layer-plan cache and revalidated current memory; the four fresh process startups used automatic fitting. None logged an allocation rejection/fallback, stream error, or timeout. The smallest observed physical GPU headroom was 645 MiB. This is a resource-stability count across separate gates, not pooled latency or a claim that all 20 answers were correct. Final workflow tests are outside this calibration review.
