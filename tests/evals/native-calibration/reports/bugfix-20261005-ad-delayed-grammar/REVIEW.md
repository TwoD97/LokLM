# AD / AD2: bounded reasoning with delayed JSON grammar

**The completed two-case diagnostic has 0/2 strict passes.** Both responses satisfy the unchanged production parser, but one remains incomplete and the other lacks a necessary citation. This is evaluation-only work on two already revealed development cases, not production behavior or unseen validation. No production source was changed or promoted.

## Outcomes

| Run / case        | Collection                          | Strict result                                                 |  Native time |
| ----------------- | ----------------------------------- | ------------------------------------------------------------- | -----------: |
| Initial AD        | 2 requested, 0 sampled; `cells: []` | Setup failure at `wrapper_boundary`; no semantic observations | Not measured |
| AD2 / ab-fresh-01 | One completed response              | Nonpass: both requested intervals omitted                     |     92.120 s |
| AD2 / ab-fresh-02 | One completed response              | Nonpass: proposal claims omit their source                    |    150.274 s |

**01** reproduces AC's visible answer exactly: an evidence-scoped unresolved lead followed only by the South heading and issue date. It omits North's 14-day interval, South's 19-day interval, and the North citation. Both complete relevant passages were present among the same eight actual-fed inputs. The quoted units are authentic, but their relevance and completeness are inadequate.

**02** correctly gives current 5 projectors and 7 tablets, rather than AC's false current/base value of 9 tablets. It also correctly describes the later proposed 9, the proposal date, explicit nonapproval and lack of authority. However, the final answer cites only base 3:3 and amendment 4:4. The proposal-specific claims require 5:5, which was supplied but is absent from the references. Correct values and two valid citation IDs do not establish complete support. This observed factual improvement is separate from the strict citation nonpass.

[Manual judgments](manual.json) record independent final-only review against the revealed source passages and sealed key. Neither hidden reasoning nor private `check` text was inspected. The original [AC sealed run](../bugfix-20261005-ac-fresh-validation/REVIEW.md) remains unchanged: one pass from three cases. These two reused cases are now known DEV and cannot be counted as fresh evidence again.

## What was executed

Inputs were reconstructed from AC's actual citation-event order and saved chunk bytes/metadata through the unchanged final production bundle. Original prompt estimates 2561/2897, mode concise (31 units) / full, and all eight supplied passages matched the app diagnostics. The exact prompt, sources, ordering, labels, schema and parser were retained; the only input-text change removed the single standalone `/no_think` token from each system prompt. Reconstructed hashes are not a claim that native prompt bytes were originally logged.

The direct public SDK runner used Qwen3.5 automatic thought framing, at most 64 unconstrained thought tokens, then closed that segment and activated a fresh JSON grammar for the constrained response using the same sequence. Both cells reached the 64-token limit and used the fixed two-token closing suffix. Combined token counts were 152 and 268, including forced closers; the hard total allowance was 2176. The constrained phase used 86 and 202 tokens respectively. These are response-envelope tokens, **not user-visible answer-token counts**; no hidden text/token arrays, private check, history or raw model envelope was retained.

Configuration was 8192 context, q8_0 KV, 14 GPU layers, 6 threads, batch 254, 1 GiB reserve, temperature 0, repeatPenalty:false. The 180-second per-cell deadline includes prefill and both generation phases; setup/model load is excluded, and the 15-second abort grace is cleanup rather than a successful time extension. Both cells completed with `stopGenerationTrigger`, no cancellation, no parser rejection and unchanged fingerprints afterward. Reported first-constrained-token timing is neither user-visible streaming nor an exact prefill measurement.

The initial AD declaration was preserved after a `wrapper_boundary` setup error, before any case sampling. AD2 separately corrected the public boundary check to recognize the exact one-token thought closer's `userDefined` attribute under the verified wrapper suffix. Input bytes and generation settings stayed unchanged. This was a disclosed setup correction with no first-attempt answers to select between; it does not erase the initial operational failure.

Direct SDK evaluation bypasses app retrieval, model handoffs and the ordinary worker route. It changes reasoning mode, directive presence and grammar timing together. The latency and semantic differences cannot be attributed solely to reasoning, and this bounded 64-token treatment is not a research-paper protocol or a general model-quality result. No further calls are included in this report.

## Reproducible artifacts and privacy

[observations.json](observations.json) is the tracked raw-observation artifact: a fixed allowlist of safe configuration/counters, hashes, setup errors and successfully validated final answers. [manual.json](manual.json) and this review are tracked. The filename avoids the repository's global ignore rule for generated `raw.json` files. No arbitrary object dump, prompt, source body, rejected prose, hidden text or private check field is copied into this artifact.

The original local generated reports remain at:

- `out/optimization-20261005/ad-delayed-grammar-native-20261005-2336/raw.json`, SHA-256 `5043959df56fe32d2ce69ea1e984d724fbe2d43a0bf12ef8ce55568583ccbbff`.
- `out/optimization-20261005/ad2-delayed-grammar-native-20261005-2341/raw.json`, SHA-256 `76978191d7f57adf6e33ddfd54bba2429b8c044d763176e27d4b9597170b39e5`.

Immutable input plan: `out/optimization-20261005/ad-diagnostic-inputs.json`, SHA-256 `d16a55dbbe8c396bb8079e195f159bf73c48d6448488ab942d49b81484621f59`. Final declaration: `out/optimization-20261005/ad2-execution-declaration.json`. That declaration pins the runner/helper/test and public SDK dependency hashes. The production manifest remains `a153fccc912c4ce974aa80d588a04cd3c8359c29940098418d1b44b51fd11af3`; no production schema, parser, renderer or model was changed.
