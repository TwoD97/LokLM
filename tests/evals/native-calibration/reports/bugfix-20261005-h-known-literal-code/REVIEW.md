# H: separate known literal-code control

**Zero strict passes out of one requested control.** The checked generation/validation path ended with one normalized error. This is an operational nonpass, not evidence that the model calculated either function correctly or incorrectly.

The predeclared question `authority-reserved-07` asks for `clampSlots(9)` from two archived code versions and which is documented as deployed. All 15 documents in the known authority corpus were imported; both required code passages 12:12 and 13:13 were actually supplied. There was no oracle source filtering, retry or repair. Normal small-document expansion was enabled.

The source/build treatment is the same frozen H `typed-comparison-v2` configuration as the [main twelve-case run](../bugfix-20261005-h-known-reasoning/REVIEW.md): manifest `ee5d5065f3eca7aa599dfbba34a3efd6731c09085a58c7b50a366be6e62871f1`, worker `8f3527f6b3707783d90a6a27e7f80948e713410b9774036a9de96d94541fe85c`. Compiled hashes were unchanged after the run. This was already known DEV, not fresh evaluation.

One checked raw call was logged with actual 8192-token f16 context, 14 GPU layers, 2176 output budget, temperature 0 and repetition penalty disabled. The worker logged its raw-call exit after 158.013 seconds. That log is emitted in a `finally` block, including generation or completion-limit failures; it does not establish successful generation. The terminal arrived at 168.522 seconds, before the fixed 180-second deadline, with:

> The answer could not be completed. Please retry or narrow the source selection.

No successful checked-result mode/outcome was logged, no grammar fallback occurred and no token-based first-visible time exists. The ordinary production trace does not retain raw structured model output or a stage-specific rejection reason. The failure could be in generation, completion validation or parsing; this artifact does not distinguish them. The displayed text is only the failure note; do not infer a semantic code verdict from it.

The harness collected the requested observation then exited 1 because that request failed. The owned process exited before source changes were released for the next candidate. Startup was 42.429 seconds and indexing 10.158 seconds. Run start: 2026-10-05T14:02:29.250Z; observation collection end: 14:06:10.847Z.

[manual.json](manual.json) records the nonpass. `raw.json` and `review-clarified.json` are local generated artifacts; raw SHA-256 is `35bd3fa1532287403b87d324d6f774b0808d5ccf7f906378185f940b5d21fc8b`. An initial review over-attributed the failure to parsing; inspecting the worker's unconditional `finally` log corrected that inference without changing the observation or verdict. This result remains separate from H's main twelve-case denominator and will not be replaced by a later control.
