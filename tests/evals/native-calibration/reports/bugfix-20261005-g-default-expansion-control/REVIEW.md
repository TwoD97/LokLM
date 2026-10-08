# G document-expansion control

The single preselected known case reasoning-reserved-07 **passes** when normal document expansion is enabled. Actual context contains the previously missing measurement table 13:15 in addition to approval header 13:14. The answer gives **24 litres** with the table citation and **2031-06-11** with the header citation, each clearly mapped in a supporting bullet. It contains no unrelated Leran material.

This is a separate configuration diagnostic after the [original 12-case run](../bugfix-20261005-g-reasoning-reserved/REVIEW.md). The sole requested setting change was `wholeDocFallback:true`, corresponding to normal small-document sibling expansion. All 18 documents were imported and retrieved normally; no oracle source selection, source edits, production rebuild or answer retry occurred. The original run's ten supplied passages omitted the table; this control supplied those ten plus table 13:15. The original failure remains in its original denominator and has not been replaced by this pass.

The control establishes that default expansion works for this case. It does not justify a new retrieval patch or imply that all missing-table cases are solved. Other fixed calibration settings, including disabled reranking, routing and multi-query, remained unchanged, so this is not an exhaustive test of every application default.

One execution completed in **119.069 s** with actual 8K/f16 context and 14 chat GPU layers. The checked call used `checked-answer-v1`, output budget 2,176, temperature 0, explicit `repeatPenalty:false`, and one raw generation. No timeout, parser error or grammar fallback occurred. The lower time than the original observation is descriptive only; there is no repeated matched latency sample.

The G build-manifest SHA-256 stayed `e13a1c6c31ea1cb7fc29999ffcfb223f6889827d1d46c746caac0ee929fed23c`; worker SHA-256 stayed `8f3527f6b3707783d90a6a27e7f80948e713410b9774036a9de96d94541fe85c`. The application sources matched that build and compiled fingerprints were unchanged after execution. Only the evaluation harness gained an explicit expansion switch, defaulting to its previous false setting; three focused forwarding tests passed before the control.

[manual.json](manual.json) is the retained judgment. [raw.json](raw.json) and [review.json](review.json) are local generated artifacts excluded from version control. Freeze metadata is in `out/optimization-20261005/g-expansion-control-freeze.json`. This case is now known development evidence and must not be described as a fresh holdout in later candidate work.
