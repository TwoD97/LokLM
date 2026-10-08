# C prototype source archive

`c-prototype-relocation.zip` retains byte-identical files from immediately before their move into evaluation code. `manifest.json` records each original path, byte count and SHA-256, together with its relationship to the frozen C plan.

The archive contains the original planner, plan generator and native runner whose hashes match C. It also contains the current parser with a later type-only correction and the unused whitespace-anchor helper. Neither was silently substituted into C's recorded grading.

The exact frozen C parser is stored separately at `frozen-C/src/main/services/qa/groundedAnswer.ts` inside the ZIP. It was reconstructed by reversing only the two later `typeof` guards and explicit source-object copy; its SHA-256 exactly matches C's recorded `3fb773f172d2467cf0bb2c44472af0c9321e4bb86137cd01172cd5c73028128f`.

For a historical replay, use an isolated checkout and the original frozen plan. Restore the archived generator and runner to their recorded repository paths so the runner's helper hash checks still pass. Native inference uses the prompt and schema already serialized in the plan; it does not execute the moved prototype modules. Original compiled-worker/model fingerprints and recorded-input checks still apply. Those native/model/input artifacts are not supplied by this source-only archive.

To reproduce original mechanical parser grading, use the separate `frozen-C` parser entry rather than the corrected relocation snapshot. Do not replace frozen plans, raw outputs or recorded grades with results from relocated or subsequently changed code. The optional `sourceQuote.ts` helper was never integrated into the frozen C parser.
