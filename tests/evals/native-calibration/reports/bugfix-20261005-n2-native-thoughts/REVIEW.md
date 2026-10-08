# N2: diagnosed format failure and incorrect current-rule selection

**The unchanged N inference treatment again failed the structured contract. Its explicitly retained unvalidated answer also gives the wrong current drill limit.** For the requested date 2031-06-01, it proposes three drills and five saws from the base rule. The supplied approved amendment increased the drill limit to four effective 2031-05-15. Five saws is correct; the drill answer ignores applicable counterevidence. Repairing the envelope would not repair this semantic failure.

N2 was a separately authorized synthetic debugging repeat, not a retry replacing N's score. It retained N's exact prompt, system, schema instructions, source text/order, allocation and generation options. The only change was the bounded diagnostic sanitizer. Six focused sanitizer tests passed, including flat-root shape capture, check/hidden-field exclusion, unknown-key suppression, bounded arrays/text and refusal to inspect serialized result strings. The initial N2 declaration and sanitizer were archived unexecuted before the requested flat-root capture was added; only the final v2 plan launched a model call.

The returned visible JSON has a flat root with known keys `resolution` and `blocks`; both `check` and the required `result` wrapper are absent. It contains two blocks with `text` and `evidence`; each `evidence` is a scalar string instead of the required array. The unchanged production parser rejected `envelope`. No object was wrapped, field inserted, quotation rewritten or answer promoted to accepted output.

The two explicit answer-text fields, retained separately as **unvalidated diagnostic text**, are:

> Mitglieder dürfen höchstens 3 Bohrmaschinen gleichzeitig leihen.

> Mitglieder dürfen höchstens 5 Sägen gleichzeitig leihen.

Each evidence string is identical to its corresponding answer text and uniquely matches supplied base-rule passage 3:3. The real supplied amendment 4:4 states its effective date and changes only the drill limit from three to four while leaving the saw rule unchanged. This is an observed applicability/authority error in the proposed answer, despite exact quote membership. It is not merely a presentation error, and it is not a retrieval omission. The quote resolver's membership guarantee remains separate from semantic support for the asked date.

N2 was frozen at 2026-10-05T17:09:59.733Z in `out/optimization-20261005/n2-native-thoughts-plan-v2.json`. The exact same eleven fed passages and question were used. Settings remained Vulkan, 8192 context, f16 KV, fourteen GPU layers, six threads, batch 254, a 1 GiB reserve, temperature 0, repetition penalty disabled, auto thoughts with budget 64, total output budget 2176 and one 180-second generation deadline. Native grammar remained omitted for the SDK segment/grammar incompatibility documented in [N's review](../bugfix-20261005-n-native-thoughts/REVIEW.md); strict v5 post-parsing remained enabled. This is not permission for a silent production grammar fallback.

The call completed naturally with `eogToken` in 101.133 seconds. It used 2484 input tokens and 176 total output tokens. Public counters recorded 64 thought tokens across 66 callbacks, and 394 visible-response characters across 112 text callbacks. First main-response text arrived at 51.755 seconds; the last callback was at 100.691 seconds. These are callback timings, not an exact prefill/thought decomposition. Allocation and exact wrapper preflight matched N. The owned process exited 0, all source/build fingerprints remained unchanged, and GPU was released immediately. No additional model call was made. **0/1 N2 requested cases produced a usable parser-accepted answer**, and the visible proposed answer has a material factual failure independently of that rejection.

The sanitizer retains only fixed known-key/type metadata, counts of unknown keys, check type/length (no check text), explicit intended answer string fields, and evidence strings/direct `quote` or `text` fields under evidence. It never dumps arbitrary objects or key names, serialized result strings, the raw envelope, history, thoughts or other hidden fields. The original N artifact remains unchanged and cannot retroactively be assigned N2's exact shape or semantic content merely because token totals match.

This known DEV direct SDK debugging observation does not demonstrate general reasoning gains, a usable grammar-free product route, or an isolated effect of thought budget. M, N and N2 show distinct recorded outcomes under their declared contracts; N2's same-input repeat was authorized to diagnose the prior unknown failure, not to select a favorable sample.

Local generated artifacts are `out/optimization-20261005/n2-native-thoughts-plan-v2.json`, `n2-native-thoughts-replay.mjs`, `n2-synthetic-capture.mjs`, its test file, and `n2-native-thoughts-native/raw.json`. The initial unexecuted preparation remains under `n2-initial-unexecuted/`. Production stayed at L manifest `bf6cd36b9af2b617a9a7b71991532045e79d52b20bfc37602f645ffb3ff51533`.

- Final N2 plan SHA-256: `c5c59e4c74a59aab3edd233afe3e558ac6060df02abba1e1081fd0a67d812280`.
- Runner SHA-256: `82a8f0448f32a7c7efae10ccfbc757f127a64561cbedaa3478a8df4eef548539`.
- Sanitized raw SHA-256: `83d98d37cc3701d454e2e479a26901afdf32b732ebb45251c0f495103d5cab1e`.
