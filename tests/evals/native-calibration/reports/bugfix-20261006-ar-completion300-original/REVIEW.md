# AR correctness coverage: original heldout10 and heldout06

**Both answers pass the unchanged original factual, completeness, citation and short-sentence criteria. Both also completed within 180 seconds.** The collection was prospectively declared with a 300-second calibration cap and consists of known DEV cases, not fresh validation or replacement observations for earlier failures.

[Safe observations](observations.json) retain exact validated finals, actual fed source order and allowlisted metadata. [Manual review](manual.json) records the independent claim-by-claim judgment.

| Case, in declared order | Strict result |  App time | Native time | Observed within 180 s |
| ----------------------- | ------------- | --------: | ----------: | --------------------- |
| heldout10               | Pass          | 141.325 s |   130.821 s | Yes                   |
| heldout06               | Pass          | 168.172 s |   150.789 s | Yes                   |

Requested **2**, attempted **2**, validated finals **2**, strict passes **2**, parser rejections **0**, timeouts **0**, unobserved **0**. Both were attempted once, with no retry or evaluation-side repair.

## Original-criteria review

**Heldout10:** Actual draft B 4:7 supplies **2027-05-15** and draft A 3:6 supplies **2027-05-08**. Both concern Orvo's single shipment in the same cycle. Neither supplied draft establishes approval or replacement priority; their issue date is identical. The final selects the two exact deadline sentences with their own correct canonical references and uses a compact lead limited to what the supplied excerpts establish. It does not choose a governing date, infer nonapproval from missing signatures, invent replacement, or claim that no deadline exists elsewhere. ISO dates render correctly despite literal Markdown escapes. The one-short-sentence display is satisfied consistently with the original compact framed-comparison criterion, with no irrelevant retention arithmetic. The English source quote remains a presentation tradeoff.

**Heldout06:** Actual supplied planned table 2:5 gives **78,165 GBP for 2025**; recorded table 1:2 gives **73,410 GBP**, with its supplied document context establishing **2024**. The difference is **4,755 GBP**. The answer preserves planned/actual status and both years, cites the two input tables locally, and uses one short German sentence. It excludes reserves and does not claim the plan was attained. The question does not require repeating both input amounts.

Question text, fixture bytes and the original criteria were unchanged. All six original documents were eligible for retrieval, and both questions received all nine indexed passages. Actual source text and document context were reviewed; valid IDs or a schema pass alone were not treated as correctness evidence.

## Runtime and collection limits

Both calls observed v19, active bounded 128 on the main route, compact JSON, q8_0 KV, 8192 context, 14 GPU layers, maxTokens 2176, temperature 0 and repeat penalty disabled. Both used a 40-unit concise catalog; heldout10 selected `comparison/unresolved`, while heldout06 selected `answered`. No unsupported-wrapper, setup-failed or grammar-fallback status occurred. The completed check/result envelopes had check strings of 120 codepoints and externalLineBreaks=0; private contents were not inspected.

Exact prompt counts were 2044/2057, prefill 2043/2056 across nine batches each. Thought/forced-closing counts were 128/2 each; constrained-response counts 108/141, combined 238/271. Those response counts include private check and JSON syntax, not only displayed prose. All fixed source-label shape categories were zero and uncapped: heldout10 inspected zero ordinary blocks; heldout06 inspected one 88-character block. Observer work was 0/1 ms.

Evaluation overrides were `rerank=false`, `multiQuery=false`, `routing=false`, `wholeDocFallback=true`; these are not all production defaults. `CONTINUE_ERRORS=0`, the full six-document corpus, fixed order and 300-second cap were declared before execution. App timing includes retrieval, preparation and handoff; native timing is a subset. Heldout06 was 11.828 seconds below 180. Timing remains a separate observed dimension, not a latency guarantee or causal optimization claim. Each group uses a new isolated profile, so request-position differences from prior collections remain material.

The [AR AB group](../bugfix-20261006-ar-completion300-ab/REVIEW.md) and this pair provide five strict passes within 180 seconds. The separate [AR09 observation](../bugfix-20261006-ar-reasoning09-completion300/REVIEW.md) is a strict content pass at **184.894 seconds**, above 180. These six observations do not establish completion of the full 13-case protocol. Pending groups receive no inherited passes. The [original AQ180 aggregate](../bugfix-20261006-aq-known-summary/REVIEW.md) and [AQ completion300 rejection](../bugfix-20261006-aq-reasoning09-completion300/REVIEW.md) remain unchanged.

## Provenance and cleanup

Declaration frozen **2026-10-06T05:25:39.418Z**; collection **05:26:00.236Z–05:32:02.395Z**; postverification **05:32:19.364Z**. All **421 source / 112 compiled** pins plus model, fixtures and harness matched, with `currentSourcesMatchBuild=true`, `changedPaths=[]`, runner exit 0, `cleanupVerified=true` and `requestCompleted=true`. Observer disposed with zero errors, dropped records and pending replies. No owned native/Playwright process or capture remained; trace/screenshot/video were off.

`safeToContinue=false` preserves the independent-review boundary; later groups require a separate root grant. No fresh facts were authored or authorized by this group.

- Frozen AR build: `c238f16db7574e4638d435a4d7191d47abba20c5670fd54bb1de29f2c255b0ea`.
- Declaration: `out/optimization-20261005/ar-completion300-original-execution-declaration.json`, SHA256 `d8aaebbb42e39762087a6bf7a592643257462bf987b0e9943fc1fabc97311b7c`.
- Postverification: `out/optimization-20261005/ar-completion300-original-postverify.json`, SHA256 `f97a91070f85ad27f5b465f96efddf35c9904381a38b39b0499cea2690fb7eae`.
- Local [raw observations](raw.json), SHA256 `d59392d9088dfbfa79133f29364ebda37812a7603894c30cac6d70d11528cf4e`.

Raw/log/declaration files are local generated artifacts; tracked review/manual/observations preserve the safe evidence. No private thought, private check, raw generated envelope or rejected prose was read. Reporting made no model calls or production, harness, fixture or criterion changes.
