# G targeted deadline regression

The single preselected **known DEV** case, heldout-10, completed once and is **partial under strict all-claims grounding**. Its main uncertainty decision, both dates, exact local citations, language and requested format pass. Unlike F, this observation does not invent replacement history or earlier/later document order.

The remaining issue is “beide ... ohne Freigabe gekennzeichnet.” Actual 3:6 says “Status: draft” and “This draft contains no approval signature or supersession statement.” Actual 4:7 says “Status: Entwurf” and that the draft contains no approval signature or statement replacing another draft. These establish absent documented approval, not an explicit designation that approval did not occur. The initial provisional pass was corrected after independent review; a correct no-final-deadline decision is not an all-claims-grounded pass.

The real application imported all six source documents and used nine retrieved/packed passages. No reference-source filtering or retry occurred. The total was **99.493 s**, including **88.935 s** for the completed checked-answer stage. Actual runtime: 8K, f16 KV, 14 GPU layers; `checked-answer-v1`, output budget 2,176, temperature 0, explicit no-repetition penalty, one raw call and no grammar fallback.

G adds one bilingual generic evidence-precision sentence to F and a conservative currency-adjacent quantity rejection. All six reconstructed F input prompts, arithmetic notes, schema and source order remained byte-identical after the latter guard; the system sentence is an intentional treatment change. Automatic RAM/profile/KV choices were not fixed, so the timing difference is not a causal speed comparison.

Build-manifest SHA-256: `e13a1c6c31ea1cb7fc29999ffcfb223f6889827d1d46c746caac0ee929fed23c`. Worker SHA-256: `8f3527f6b3707783d90a6a27e7f80948e713410b9774036a9de96d94541fe85c`. Pre-run freeze: `out/optimization-20261005/g-production-freeze.json`. Current sources matched the build, and compiled fingerprints were unchanged after the run.

This targeted follow-up is intentionally selected after observing F, and cannot be presented as a fresh holdout or a clean estimate of general accuracy. The positive current-rule control is [recorded separately](../bugfix-20261005-g-known-authority/REVIEW.md). The separate 12-case source-disjoint challenge remains previously unrun and sealed; its author also advised candidate development, which limits independence even though the root and answer reviewer had not opened its facts or answers.

The retained judgment is [manual.json](manual.json); [raw.json](raw.json) and [review.json](review.json) are local generated artifacts excluded from version control. Only the final visible answer was graded; the internal model-authored check is not a semantic certificate.
