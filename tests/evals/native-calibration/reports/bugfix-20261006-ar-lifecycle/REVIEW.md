# AR bounded-128 lifecycle check

**PASS:** one actual-app attempt, zero retries, on the frozen AR/v19 candidate. The recorded synthetic-vault assertion interval ran from `2026-10-06T06:27:18.787Z` to `06:32:29.092Z` (310.305 s). Its original 660 s test limit and 180 s completed-reuse limits were unchanged.

| Phase               | Observed measurement                              | Assertions passed                                                                                                                                            |
| ------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stop during prefill | 2.977 s observation interval; 2.593 s native call | 254 of 3,021 prefix tokens processed in one batch; zero thought, visible, or combined generated tokens; one cancelled terminal and interrupted persistence   |
| Same-worker reuse   | 97.842 s native generation                        | Active bounded-128 path, normal completion, approved-source citation and exact persisted answer; no worker restart or late events from the cancelled request |
| Vault lock          | 2.229 s lock-phase interval                       | Private request retired, empty private terminal, nonresident model and user-only persisted turn                                                              |
| Unlock reuse        | 100.654 s native generation                       | New worker, active bounded-128 path, normal cited completion and persistence; prior listeners unchanged                                                      |

Both reuse calls satisfied their 180 s test assertions. Each used 128 thought tokens, two forced-close tokens and 89 visible tokens (219 combined). The measured allocation was Q8_0 KV, an 8,192-token context, 14 GPU layers, six inference threads and 1 GiB VRAM padding. The partial-prefill batch contained 254 tokens. Allocation remained adaptive; this is not a fixed-allocation performance comparison.

Postverification matched all declared source, compiled, model and native-binary pins. The dependency admission records the new fixture-family LF metadata separately from the unchanged dependency freeze. All test assertions completed, owned processes exited, and capture cleanup found no capture files to remove. No private thought/check text or raw structured envelope is included here.

This is **current 128-token lifecycle evidence**, covering the cancellation, reuse, lock and unlock sequence above. Historical AI64 lifecycle results and automated unit checks remain separate carried evidence. This test does not establish answer quality, unseen-case reliability, all-provider behavior or a universal 180 s response guarantee.

## Provenance

The generated inputs and logs remain local; their hashes identify the preserved artifacts without publishing machine paths or private content.

| Artifact               | SHA-256                                                            |
| ---------------------- | ------------------------------------------------------------------ |
| Lifecycle declaration  | `94d21fcef027427f396019045819c5e12cc2f79973d5e4c35f2e656b8ab85ffb` |
| Build manifest         | `c238f16db7574e4638d435a4d7191d47abba20c5670fd54bb1de29f2c255b0ea` |
| Result                 | `b33b552619aa273e7ab5fd13f059ba56e52118ada497b9a657fb4bb938d76ff4` |
| Postverification       | `1b675c93d935aab2426103dd5c9ccef7d8359af67e07a6a5cca5a8d0a2b09622` |
| Capture-cleanup report | `b9e46487d2f714db6d88463cd9cf9f81fae9c86482617eed701905f4f68243ff` |

See [observations.json](./observations.json) for the content-free measurements and log hashes. No fresh-corpus inference was performed by this lifecycle check.
