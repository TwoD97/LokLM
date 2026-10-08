# L first gate: quotation validation failed

**The one requested known-case attempt produced no usable answer.** It failed closed after 144.406 seconds, within the 180-second deadline. Native generation completed, but the parser logged `quote_missing`; the user received the localized failure message and status note. This is a structural/output-contract failure, not a supported answer, timeout, or demonstrated semantic improvement.

L groups two changes: quotation-derived source identities without model-authored IDs, and a shorter 120-character check with concise output guidance. Exact matching permits whitespace differences but preserves source words, punctuation and case. Matches must be globally unique across the supplied catalog; membership still does not establish semantic relevance, authority or entailment. The native schema and parser bound evidence per record and total lookup work. No source was silently substituted to rescue this observation.

The exact freeze `out/optimization-20261005/l-production-freeze.json` was recorded at 2026-10-05T16:27:58.956Z. Manifest SHA-256: `bf6cd36b9af2b617a9a7b71991532045e79d52b20bfc37602f645ffb3ff51533`. Worker SHA-256: `38e51d9c74849be2b844164cbb5f9ab38fee68238fcf7f51bdfdd8a25232df28`. Source/build parity and final public no-model Vulkan grammar-smoke input hashes were verified before launch. Compiled bytes remained unchanged through exit. The smoke passed the exact `typed-comparison-v5` grammar with 1, 2, 10 and 32 supplied sources; grammar admission does not prove that the model will produce a valid quotation or useful answer.

All eighteen source documents were imported, default small-document expansion was enabled, and no gold-source filtering was applied. The single selected question was `reasoning-reserved-02`; no other case was attempted, no hidden retry occurred, and no continuation was launched after failure. Actual required passages 3:3/4:4 were among eleven supplied passages. This is a known DEV gate, not a fresh challenge or replacement for any J/K result.

| Content-free measurement                  |           Observation |
| ----------------------------------------- | --------------------: |
| Actual restored context / KV / GPU layers |       8192 / f16 / 14 |
| Prompt estimate / output allowance        |    2675 / 2176 tokens |
| Grammar compilation / prompt-fit check    |             5 / 30 ms |
| Native execution                          |             133830 ms |
| First text / non-whitespace callback      |              22417 ms |
| Last text / non-whitespace callback       |             132700 ms |
| Response characters / callbacks           |             604 / 245 |
| Public token-meter input / output         |     2459 / 246 tokens |
| Native completion reason                  | stopGenerationTrigger |
| Parser rejection                          |         quote_missing |
| Total request time                        |             144406 ms |

The native request used temperature 0, disabled repetition penalty, no thinking budget and the unchanged 2176-token allowance. There was one raw generation and no grammar fallback. No generated check, partial JSON or hidden thought text was retained/read. Therefore the rejection must not be described more specifically as paraphrasing, punctuation loss, quotation truncation, or any particular wrong-source answer. The parser's category establishes failure to obtain an accepted source anchor, not the exact cause or the proposed answer's semantic correctness.

Startup took 42.523 seconds and indexing 11.205 seconds. Sampled peak GPU use was 3457 MiB, not a guaranteed maximum. There was no first-visible answer token: internal response callbacks occurred, but the final structured answer failed validation. The owned process exited 1, cleaned up, and GPU was released immediately. Faster raw generation than the separate K observation does not establish a useful latency gain when no answer is delivered, nor isolate either member of this grouped change.

[manual.json](manual.json) is the tracked assessment. Local generated `raw.json` and `review.json` preserve evidence and auxiliary grading; raw SHA-256 `0e65a756d205727e0e725466e4b79bd771f7ce7fcca388376ae3d906507076fd`. J/K failures remain unchanged, and the remaining L cases were not authorized or attempted after this first gate failed.
