# 25 September optimization and controlled passage experiment

This continues the [24 September native calibration](2026-09-24-native-calibration.md). The original held-out answers have already informed development; no result below is described as untouched validation.

## Changes under review

- Reuse a successful GPU layer hint across changes to the actual context's KV preference. Native weight fitting still uses its F16 defaults, so a different later context precision does not change the weight-fit identity. Every allocation retains fresh native checks, the existing reserve, and bounded disposal/fallback. Actual context precision remains adaptive.
- Treat the provider's completed answer as authoritative for display and persistence; keep failed or interrupted partial replies visibly incomplete.
- Restrict source navigation to supplied passages in both streaming and saved replies. A provided-context list is navigation, not evidence that every claim is supported.
- Experiment with repeating each passage's exact source marker after its complete text. `LOKLM_SOURCE_MARKER_FOOTERS=1` opts in; the normal prompt remains unchanged when unset. One renderer charges the additional framing in both packing and generation. This adds no model call and does not rewrite generated claims.

## Pre-run comparison protocol

Build once after focused checks and TypeScript validation. Keep that build, the installed model files, six-thread default, 1,024 MiB reserve, requested 8,192-token context, canonical citation labels, exclusive GPU handoff, and retrieval settings identical in both arms. Only the footer flag changes. Each arm uses a fresh isolated vault with the same synthetic development corpus and case order.

Initial diagnostic order: `dev-06`, `dev-03`, `dev-07`, `dev-11`, one answer per case per arm. These cover the known two-table attribution failure, an approval date, a German identifier, and the lower branch of a code calculation. The selection is a narrow failure probe, not an accuracy estimate. Both answers and all errors remain in the results. Inspect the full supplied passages and every inline marker; a correct number with the wrong passage is a failure.

A footer change cannot be enabled from these four cases alone. Promotion requires checking the remaining development cases and the separate English/German authority regression, including safe missing-fact answers and approved supersession. If the initial probe introduces an error or fails to show a useful gain, keep the experiment off and record the limitation without repeatedly rewriting the prompt from the answers.

Record startup, indexing, first visible text, completion, actual context and GPU layers, KV choices, automatic fits versus hint reuse, allocation failures, and whole-card memory samples. The harness now records free and total system RAM alongside each GPU sample. Compare per-case timing before reporting medians. Ordered runs share a workstation with variable background RAM/GPU use, so timing differences are descriptive rather than a causal performance estimate. The new cache-key behavior can be confirmed directly from the startup and first-query allocation logs.

## Results

The first four-case comparison is complete: control **3/4 fully supported**, footers **4/4 fully supported**. Both runs returned the correct revenue difference, EUR 5,520. The control cited the 2025 introduction/table and omitted the planned-2026 table; the footer answer cited both exact input tables. The approval-date, German identifier, and lower code-branch answers were otherwise identical and fully supported. Full source/build/model hashes, corpus text, and supplied passage order match between arms.

This is a promising diagnostic result, not an isolated causal estimate: the comparison question used Q8 KV in the control and F16 with footers, and background RAM pressure differed. The other three matched questions used F16 in both arms. No timeout, stream error, or allocation failure occurred. [Control review](../../tests/evals/native-calibration/reports/dev-20260925-footer-control/REVIEW.md), [footer review](../../tests/evals/native-calibration/reports/dev-20260925-footer-on/REVIEW.md), and [paired resource measurements](2026-09-25-footer-resource-review.md) preserve the full comparison.

The separate four-question authority regression made the correct primary decision in all four cases: preserve unresolved drafts, or use the explicitly approved superseding revision. However, the German unresolved answer omitted both proposed dates, and the German approved-revision answer added a historical date without citing the passage that contains it and did not follow ISO formatting. The English unresolved answer was factually complete but long. Manual categories are one safe abstention, one supported answer, and two partial answers, not four complete passes. [Authority regression review](../../tests/evals/native-calibration/reports/conflict-20260925-footer-on/REVIEW.md).

The remaining eight development questions completed on the same frozen build. Across all twelve footer-enabled development questions, **9/9 answerable responses were fully supported, and 2/3 uncertainty responses were fully safe**. The remaining missing-temperature response correctly declines a numerical value, then claims the report says no outdoor temperatures were measured. The actual passage only says the report contains no outdoor-temperature measurements; absence from a report does not establish that no measurement occurred. This unsupported extra claim is counted as a partial failure, not a successful abstention. [Remaining development review](../../tests/evals/native-calibration/reports/dev-20260925-footer-coverage/REVIEW.md).

**Selection: keep passage footers opt-in.** The targeted benefit is promising, but the small matched sample has a precision/memory confound and the broader trial exposes attribution, completeness, and source-description failures. No further prompt was tuned from these answers. The allocation and chat-completion fixes remain active independently. Twenty calibration answers were observed across four runs; all source passages, outputs, errors, and partial failures remain in the reviews. These small synthetic development/regression sets are not a general accuracy estimate.

## Completed implementation checks

Across all twenty calibration questions, every chat restoration reused a successful layer hint with fresh memory validation. All retained 8K context, 14/33 chat GPU layers, six inference threads, and the configured 1,024 MiB reserve. Four fresh app processes performed their initial automatic fit; there were no allocation rejections, fallback attempts, stream errors, or timeouts. The lowest sampled physical GPU headroom was 645 MiB. On the paired trial, restoration took 10.592–11.775 seconds. The reserve setting is not a claim that a full GiB stayed physically unused, and 1.5-second samples can miss brief peaks.

The allocation change passed 19 focused tests, including cross-precision reuse with current-context validation and disposal before bounded fallback. Prompt and context tests passed 127 checks, including 18 footer-specific checks. Citation parsing, snippet extraction, and terminal persistence passed 65 focused checks; two additional tests exercised the real encrypted SQLite store under Electron's Node runtime. Plain Node could not load the Electron-built SQLite binary because its ABI differs; the dependency was not rebuilt or replaced.

The renderer passed 45 focused checks covering live source membership, reserved citation links, provided-versus-cited labels, delayed completion events, unsaved replies, cancellation before inference, navigation during generation, and incomplete preparation status. Full TypeScript checking, scoped lint, and the production build passed before native testing. Test groups are implementation checks, not a model-accuracy score.

The chat handler now returns its normalized terminal in the invoke reply as well as sending it on the stream channel. The renderer deduplicates these two delivery paths, so channel order cannot turn an unsaved failure into an optimistic reload. A failed save remains copyable on screen. Source-write failure attempts to remove the newly inserted assistant row; if both writing and rollback fail, the terminal explicitly reports an unsaved failure. The two writes are not claimed to be a single atomic database transaction.

## Final normal-mode workflow validation

Both real GPU workflow tests passed on the same build with footers disabled, in 3.8 minutes total:

- Chat answered before and after reindexing. For both answers, the returned terminal matched the emitted terminal, and its text and citations exactly matched the saved assistant row. Indexing preempted an active background title request after 1.166 seconds. This is a real Electron API and persistence check; it is not presented as a complete manual chat UI walkthrough.
- The twenty-page synthetic PDF produced 40 chunks and 40 durable vectors in 29.541 seconds, including import and GPU handoff, with 16 progress events. The import/stop UI was exercised. Cancellation stopped after the current batch and released the activity gate; explicit warmup restored chat using the checked layer hint. The indexing progress and completion screenshots were inspected: progress is visible, the completed row shows 40 chunks, and the header correctly says chat is available on demand.

Artifacts: `out/native-calibration/workflows-20260925/`. The fixture is a generated text-layer PDF, not a scanned-document throughput claim. All calibration and workflow tests used isolated temporary vaults. Existing user documents and settings were not reindexed or rewritten. After cleanup no Electron process remained; sampled whole-GPU usage returned to 1,734 MiB.

The app is left closed. Start the updated normal configuration with `pnpm.cmd dev`. Optional passage footers remain available only with `LOKLM_SOURCE_MARKER_FOOTERS=1`; no experimental setting was persisted into the user's environment.
