# G targeted current-rule regression

The single preselected known positive control, authority-reserved-03, passes strict manual review. It gives the current annual fee of 84 EUR with actual passage 5:5, and accurately distinguishes the 96 EUR proposal, unvoted status and nonbinding draft with local 6:6 markers. The evidence-precision instruction did not cause a false refusal or false conflict in this observation.

All 15 source documents were imported and ten actual retrieved/packed passages supplied. One execution completed in **95.807 s**, including **84.836 s** in the checked stage, without retries, transport errors or grammar fallback. The actual call used `checked-answer-v1`, 8K context, 2,176 output tokens, temperature 0 and explicit `repeatPenalty:false`; runtime f16 KV and 14 GPU layers. The checked text is not itself a proof of semantic support.

Together with the [deadline control](../bugfix-20261005-g-known-original/REVIEW.md), G has **one strict pass and one all-claims precision partial** on two deliberately selected known questions. The deadline's main uncertainty decision and dates pass, but its approval wording still overstates absence of documented approval. No clean two-case pass or broad model-quality guarantee is claimed.

Build-manifest SHA-256: `e13a1c6c31ea1cb7fc29999ffcfb223f6889827d1d46c746caac0ee929fed23c`; worker SHA-256: `8f3527f6b3707783d90a6a27e7f80948e713410b9774036a9de96d94541fe85c`. Current sources matched the build and compiled fingerprints were unchanged after execution. The separate source-disjoint challenge remained presealed and unrun; its author also contributed to candidate design, so it is not an independently authored blind holdout.

[manual.json](manual.json) contains the retained manual judgment. [raw.json](raw.json) and [review.json](review.json) are local generated artifacts excluded from version control. Their source text and observations were not changed by review.
