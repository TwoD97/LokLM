# October 5 presealed reasoning challenge

These 12 questions and 18 short synthetic source documents were sealed at `2026-10-05T10:48:49.763Z` and published unchanged after candidate G was frozen. Original seal SHA-256: `0b828e0eb1427fc4e0f1abc63c9fb87b9d9399e7a29cba0f1695bc4280b0b6cd`. The `.sha256.json` file is the original seal, copied byte for byte; loading the split verifies its manifest and all source hashes. The G application build-manifest hash is `e13a1c6c31ea1cb7fc29999ffcfb223f6889827d1d46c746caac0ee929fed23c`.

This is a **previously unrun, presealed, source-disjoint challenge**, not an independently authored blind holdout. The research agent authored the source documents, questions and gold metadata, and also contributed to candidate design and evaluation. That shared authorship creates contamination risk. The root implementer and independent answer reviewer had not opened these facts or answers before final candidate freeze; no model outputs from these cases were available during tuning. Publication did not replace or repair the sealed inputs.

All sources are imported before the application retrieves its own context. Reference source keys are used only for review, never for selecting model input. There are seven answerable questions and five uncertainty/missing-information questions, six in each language. A single run with all 12 requested cases, no outcome-dependent retries, and preserved operational failures is intended. Results apply only to this small synthetic challenge, not general reliability.

## Disclosed fixture authoring defects

The sealed `referenceAnswer` prose contains joined words and numbers. On publication, eight regex checks in six cases failed to match their own reference string because word boundaries were missing: current contribution (05), morning/evening counts (06), water (07), north/south results (08), total (09), and rate (11). The manifest and references remain unchanged. These reference strings are not sent to the model, and source facts/questions are unchanged. Review must inspect actual source passages and visible answers; neither reference-string equality nor mechanical regex flags establish correctness. The fixture test preserves the exact known mismatch list so subsequent additions or changes are visible.

The original seal metadata's terse purpose is historical. This note provides the fuller authorship and evaluation limitations without rewriting sealed bytes. `.gitattributes` and `.prettierignore` protect byte stability on checkout and formatting.
