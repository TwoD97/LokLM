# Memory estimation and optional retrieval cutoff — 6 October 2026

Two reproduced defects are corrected: quantized KV-cache estimates used the wrong storage unit, and optional dynamic-K retrieval applied sigmoid to scores that were already nonnegative ranking weights. Neither correction establishes faster inference, better answers, or correct citations. Dynamic-K remains off by default.

## Quantized KV-cache arithmetic

The installed `node-llama-cpp@3.21.1` heuristic multiplied scalar element counts by `ggml_type_size`, which returns bytes per encoded **block**. Key and value caches must independently use `typeSize / blockSize`:

| Type | Bytes per block | Scalars per block | Bytes per scalar |
| ---- | --------------: | ----------------: | ---------------: |
| F16  |               2 |                 1 |                2 |
| Q8_0 |              34 |                32 |           1.0625 |
| Q4_0 |              18 |                32 |           0.5625 |

The old arithmetic overstated these quantized attention-cache components by 32 times; this is not a multiplier for the whole context estimate. F16, recurrent state, graph/output overhead and CPU/GPU layer partitioning remain unchanged. The native V2 simulator's successful path is untouched, but its fallback uses the corrected heuristic. Missing, invalid or nonpositive type/block metadata now raises an explicit error instead of guessing F16; an error from the V2 fallback propagates to its caller.

The same defect was inspected at upstream commit `0ad4a867b05f35def42ffc84d501e9a55077b531`: [KV arithmetic](https://github.com/withcatai/node-llama-cpp/blob/0ad4a867b05f35def42ffc84d501e9a55077b531/src/gguf/insights/GgufInsights.ts#L992), [native size/block bindings](https://github.com/withcatai/node-llama-cpp/blob/0ad4a867b05f35def42ffc84d501e9a55077b531/llama/addon/addon.cpp#L78), and [existing tensor-size handling](https://github.com/withcatai/node-llama-cpp/blob/0ad4a867b05f35def42ffc84d501e9a55077b531/src/gguf/insights/GgufInsights.ts#L1550). The [pnpm patch](../../patches/node-llama-cpp.patch) preserves its earlier loader guard and README deletion.

[61 maintained tests](../../tests/unit/scripts/node-llama-kv-estimate.test.mjs) exercise the actual installed SDK with synthetic metadata and a mocked addon, including mixed key/value types, partial GPU placement, recurrent/hybrid state, sliding-window behavior and forced V2 fallback. Before patching, 10 passed and 51 failed: 30 failures exposed valid arithmetic/fallback defects, while 21 cover the intentional invalid-metadata behavior change. After installation, all 61 pass without loading a native backend or model.

Installation updated the lockfile with scripts disabled, then passed a frozen-lockfile install with scripts disabled. The installed estimator exactly matches the frozen candidate SHA-256 `11c2d2f04afcd0c6625230320f0277ff05d883609d664035ad846d038b45eeef`; the retained loader guard remains `90fa559a29595efbd06dc16f086e08693e27854225626d41c28bb5c861a9c4eb`. All seven previously recorded SQLite/SDK native binaries have unchanged hashes. No native rebuild or GPU measurement was performed.

The arithmetic assumes valid block-aligned GGML rows. Tests of another block size do not establish native support for that KV type, and malformed model dimensions remain outside this patch. There is no evidence that this defect caused the earlier 14-layer placement or that correcting it increases available GPU layers.

After the BG diagnostic closed, the SDK patch was normalized to LF and given an explicit Git line-ending rule. pnpm already normalizes line endings before calculating its patch hash, so the lockfile hash and installed SDK remain unchanged. The new raw patch hash is `c23a97dfe9680785f37f73eef21569377c83fc8c1f10f67ab93059ec6dad77a3`; historical build/report hashes remain evidence of their original snapshots. Narrow Git rules also preserve frozen diagnostic review text and its source ZIP across checkouts without rewriting those artifacts.

## Optional dynamic-K retrieval

RRF scores are positive reciprocal-rank sums. The bundled SDK already returns normalized relevance scores; the Ollama adapter strictly admits finite values from zero to one. Retrieval's later boosts can raise those weights above one. Applying sigmoid again concealed relative drops in all these supported paths.

The [helper](../../src/main/services/retrieval/heuristics.ts) now requires an explicit nonnegative score domain and compares consecutive weights directly, retaining the strict `< 0.6` threshold. Invalid, negative, sparse or unsorted scores disable the optional cut. Tests cover ties, zero/subnormal values, scale invariance and bounded minima/maxima; invalid integer bounds raise `RangeError`.

An actual cut also restricts the eligible primary prefix before [document diversification and code-share selection](../../src/main/services/retrieval/RetrievalService.ts). Reducing only the count let weaker suffix hits displace stronger retained hits. With no cut, the wider pool remains available. Default and explicitly disabled fixed-K, existing relevance floors and cancellation behavior remain unchanged. Later whole-document/neighbour expansion still operates separately, so the prefix rule is not a guarantee that excluded text can never enter final context.

[33 new regressions](../../tests/unit/retrieval-dynamic-k.test.ts) plus 128 existing retrieval/RRF/heuristic cases passed: **161/161** after promotion. Unchanged production failed 16 new cases; these include API/validation changes, not 16 distinct arithmetic defects. A count-only mutant with corrected ratios but unrestricted eligibility failed four service cases, independently demonstrating the selection defect. Full production TypeScript checking reported zero diagnostics, and the scoped diff check passed.

These are CPU correctness checks. RRF gaps are rank artifacts, and optional cutoffs can reduce recall. No threshold/default change, native quality experiment or answer-quality guarantee follows from these results.

## Retained evidence

Local artifacts remain under `out/optimization-20261005/kv-estimator-proposal/`: `final-freeze.json`, `installation-proof.json`, `install-lock.log`, `install-frozen.log`, and `installed-green.log`. The seven-binary baseline is `dependency-review/remediation-native-before.json` under the same optimization directory. Dynamic-K evidence is in `dynamic-k-proposal/`: `final-freeze.json`, `production-results-final.json`, `candidate-results-final.json`, `mutant-results.json`, `promotion.json`, and `promoted-verification.json`. These ignored local artifacts supplement the committed patches and reusable tests; they are not shipped application data.
