# AM app replay: two strict passes, one missing-explanation partial

**All three answers have the correct requested values, decisions and supporting citations. The unchanged original rubric yields 2/3 strict passes:** AB02 omits the explicit nonapproval explanation required by that rubric. It is not a factual, citation or authority-decision error. All three calls completed within the app deadline, with zero retries or timeouts.

[Tracked observations](observations.json) preserve every exact final answer, actual supplied source order and safe treatment counters. [Manual judgments](manual.json) keep the strict completeness result separate from factual correctness and citation support. No private check, hidden thoughts/token arrays, rejected prose or raw generation envelope was inspected or retained here.

| Order | Case        | Strict result                                    | Values / decision / citations | App seconds | Native seconds |
| ----- | ----------- | ------------------------------------------------ | ----------------------------- | ----------: | -------------: |
| 1     | ab-fresh-01 | Pass                                             | Correct and complete          |     122.345 |        110.557 |
| 2     | ab-fresh-02 | Partial: explicit nonapproval explanation absent | Correct and complete          |     156.692 |        138.313 |
| 3     | ab-fresh-03 | Pass                                             | Correct and complete          |     145.278 |        126.685 |

## Independent original-criteria review

**AB01 passes.** The answer includes South's exact **19-day** interval with 2:2 and North's exact **14-day** interval with 1:1, both for NP-6 filters in campaign S8. Its compact framed sentence limits uncertainty to what the supplied excerpts establish. It does not choose a binding winner, deny that approval ever occurred, invent supersession or assert that no interval exists anywhere. Both requested alternatives and local references are present, with no irrelevant heading/date units. Retaining the original English sentence in the German frame remains a presentation tradeoff under the existing criteria.

**AB02 answers the literal question correctly, but remains narrowly partial under the original key.** The final gives **5 projectors and 7 tablets**, then correctly says the later working paper does not change those limits. Actual base 3:3 supplies the retained tablet value, approved/effective amendment 4:4 supplies the current projector value, and proposal 5:5 supplies the paper's lack of authority. All three canonical references attach locally to that coherent paragraph. Every visible claim is supported; the earlier AK missing-source problem is resolved in this observation.

The sealed rubric's `required.abf-proposal` nevertheless explicitly requires the fact that the proposal was **not approved**. The final does not state that reason. Saying a paper “does not change” current limits does not itself entail nonapproval; an approved future change could also leave today's limits unchanged. Thus the original key demands an explanation beyond the literal question's yes/no effect request. We retain that strict requirement consistently with the earlier AK report, without silently relaxing it for AM. Both independent review and the lead reviewer agreed on this separation: **requested-answer, factual and citation pass; strict explanation-completeness partial**. No criterion or fixture was edited.

**AB03 passes.** Planned 2037 main-campus receipts of 29835 CHF minus recorded 2036 receipts of 27460 CHF equal **2375 CHF**. The single short sentence retains the years and actual/planned distinction, attaches both input references 6:6 and 7:7, and does not add reserves or use the Annex figure. Repeating the input amounts is not required by the question.

The strict aggregate is **2 passes and 1 partial**, not 3/3. Separately, **3/3 requested values/change decisions and their citation support are correct**. This distinction records the remaining omission without misclassifying it as the earlier false current-tablet value, unsupported authority inference or citation gap.

## Observed app treatment and timing

AM uses `typed-comparison-v15`, a 128-token bounded thought allowance, compact JSON whitespace and generic completeness/citation instructions. The check-plus-result structure, source admission and validation boundaries retain the declared contract. This is a combined candidate change; the observations do not isolate the contribution of allowance, instructions or generation details.

The original AB01→02→03 questions ran once with all eight original documents eligible, actual app retrieval and default whole-document expansion. The established harness disables reranking, multi-query and routing. Actual supplied passage counts were 8, 8 and 7; all required passages were present. No gold-source selection, output repair or retry was used.

Every call logged active bounded reasoning on the main route, **maximum 128**, q8_0 KV, 8192-token context, 14 GPU layers, temperature 0, repeat penalty disabled and maxTokens 2176. AB01 used the concise 31-unit catalog; AB02 and AB03 used full mode. Each worker start explicitly reported `jsonWhitespace=compact`, and each successfully parsed observer envelope had **`capture.externalLineBreaks = 0`**. There was no unsupported-wrapper, setup-failed or grammar-fallback event.

| Case | Prompt tokens | Prefill tokens / batches | Thought | Forced closing | Constrained response | Combined |
| ---- | ------------: | -----------------------: | ------: | -------------: | -------------------: | -------: |
| AB01 |          1592 |                 1591 / 7 |     128 |              2 |                   80 |      210 |
| AB02 |          1427 |                 1426 / 6 |     128 |              2 |                  152 |      282 |
| AB03 |          1268 |                 1267 / 5 |     128 |              2 |                  131 |      261 |

All ended with normal `stopGenerationTrigger`, one completed terminal and a settled invocation. Observer check metadata was string length 92/120/120 codepoints; no check content was read. Constrained-response tokens include JSON syntax and the private check, not just displayed prose. Compactness counts external JSON line breaks, not escaped source newlines.

These are measured **app** completions under the 180-second per-request deadline, which includes retrieval/preparation. Native timing is only its generation portion and must not replace app timing. App margins were 57.655, 23.308 and 34.722 seconds. This one small known DEV run is not a latency guarantee or evidence of general reliability.

## Provenance and cleanup

The declaration froze at **2026-10-06T02:34:04.908Z**. Collection ran **02:34:26.878Z–02:42:25.100Z**; postverification completed at **02:43:08.135Z**. All 419 source and 112 compiled pins, model/fixture/harness bytes matched. The observer was disposed with zero errors, dropped rows or pending replies. No owned native/Playwright process or browser capture artifact remained. Trace, screenshot and video capture were explicitly off; the runner exited 0.

- Build manifest SHA-256: `d32baf0034fe6656de0da204472110b259cfcdf8a6b8a51ad45b2b96822d0b4f`.
- Compiled worker SHA-256: `c2b3c41142a9523a108f9467981215cb3e5fbd0049468755c583edeae7798645`.
- Declaration: `out/optimization-20261005/am-ab-replay-execution-declaration.json`, SHA-256 `c8d6d31d4ecc8aca33b0acea98288bc0129d444bd673b0e5b8a4ea1daa9316ab`.
- Postverification: `out/optimization-20261005/am-ab-replay-postverify.json`, SHA-256 `a5a070321d1b9c3c242539d96ba88978831d6c35d4f14da10748022efd0fbb08`.
- Original local [raw observations](raw.json), SHA-256 `9b752869532e1354689004242591c6d0d5ad84eb249e7a44283005fb34d25480`.
- Unchanged original rubric SHA-256: `1f58336d4e09cd0c17d05419bfed55fe96271d69cbc4f4814da5ba3b903f4079`.

Raw/log/declaration files are generated local artifacts; the review, manual judgments and safe observations preserve the result in version control. Earlier [AI](../bugfix-20261006-ai-ab-replay/REVIEW.md), [AJ](../bugfix-20261006-aj-ab-replay/REVIEW.md), [AK](../bugfix-20261006-ak-ab-replay/REVIEW.md), [AL](../bugfix-20261006-al-bounded128/REVIEW.md) and original AC findings remain unchanged. These are known DEV cases, not new validation data. Report preparation made no production, harness, fixture or grading changes and launched no model.
