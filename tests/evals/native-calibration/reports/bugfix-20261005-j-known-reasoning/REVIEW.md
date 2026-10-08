# J: initial known twelve-case run, stopped on case 01

The run requested all twelve known challenge cases. **Only case 01 was attempted; it reached the fixed 180-second deadline without a completed answer. Cases 02–12 are unobserved in this original run.** This is an operational failure, not a semantic authority verdict. A separately declared continuation attempts only the previously unattempted cases; no failed case is retried.

J uses source-linked answered records with program-generated canonical citations per record, plus concise comparison guidance. Source relevance and claim support remain model judgments; record-local source membership is not semantic verification. The frozen schema is `typed-comparison-v4`.

Production freeze: `out/optimization-20261005/j-production-freeze.json`, 2026-10-05T15:16:44.676Z. Manifest SHA-256 `618e1d3d26385d521731759fe28b664d8c8fb8ece233c8de4a7d1f4a67b2c045`; worker SHA-256 `aefe7e00ece302e082ef1758574fc707ffbfb7be5f42a42a86227189700d1d37`. Provenance matched current sources and compiled bytes remained unchanged after exit. The public no-model Vulkan grammar smoke compiled this exact version for 1, 2, 10 and 32 supplied source identities; that checks grammar admission, not generated-answer quality.

All 18 source documents were imported. Normal small-document expansion was enabled; no gold-source filtering, retry or inference-setting change was used. The run remains known DEV with the previously disclosed shared-author limitation.

Case 01's actual restore was **8192 context, q8_0 KV, 14 GPU layers**. The startup f16 snapshot did not describe the query's restored context. Its prompt estimate was 2588 tokens, 11 passages were supplied, and the output allowance was 2176 tokens. Temperature was 0 and repetition penalty disabled. Retrieval took 0.186 seconds. The raw-call finally log reported 169.928 seconds and cancelled=true; no native completion stopReason/responseChars or successful parsed outcome was logged. Total time was 180.736 seconds, ending in one clean cancelled terminal. Both required 1:1/2:2 passages were supplied, but their eventual interpretation is unknown.

Startup took 42.624 seconds and indexing 10.292 seconds. The owned process exited 1 and cleaned up before the next app launch. A single timeout with differing adaptive KV/resource conditions cannot be causally attributed to the schema or prompt.

[manual.json](manual.json) and the unchanged local `raw.json` preserve the observation; `review.json` is an auxiliary local generated report. Raw SHA-256: `e0e38156edc661fe256ec43519db668d189cf7b6063fcfdafeda193bc4ea9f91`. The original requested-twelve denominator is retained. [Continuation 1](../bugfix-20261005-j-known-reasoning-continuation-1/REVIEW.md) is declared in `out/optimization-20261005/j-continuation-1-declaration.json` and covers only 02–12 under the identical build/settings.
