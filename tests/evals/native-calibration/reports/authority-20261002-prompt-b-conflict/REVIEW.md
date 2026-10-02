# Prompt-only B: original four conflict cases

All four requested calls completed with no timeout or terminal mismatch. Assessment was disabled, context was 8192, and the configured question timeout was 300 seconds rather than the baseline's 180 seconds. All four answers finished below either cutoff.

| Case                       | Independent result                                                                 | Remaining limitation                              |   Total |
| -------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------- | ------: |
| 01 EN unresolved           | Safe and complete, exact deadlines and both sources                                | None identified in this case                      | 69.91 s |
| 02 DE unresolved           | Correct safe decision, both exact sources                                          | Omits both requested competing dates              | 63.57 s |
| 03 EN approved replacement | Correct final ISO date, old date, replacement explanation and both exact citations | None identified in this case                      | 81.52 s |
| 04 DE approved replacement | Correct final date and authority, all emitted claims supported by new revision     | Uses natural German date instead of requested ISO | 64.33 s |

Strict full compliance is **2/4**, with **2/4 partial**. All four preserve the correct finality/authority decision. Compared with the original baseline, the German unresolved answer no longer invents replacement authority, and the English approved answer no longer assigns the final date to the old revision. This is a small development observation, not a broad accuracy estimate or reserved result.

The German approved answer cites only revision2, which contains every fact that answer actually states. It does not repeat the old date this time. Accordingly its citation support/completeness pass manual review even if the fixture's document-coverage heuristic asks for both revisions; its remaining failure is requested formatting. In this run ArvenA is document1/chunk2 and ArvenB document2/chunk1, and the actual cited pairs are correct.

The median total among the four calls is 67.12 seconds. The renderer/model-wrapper/prompt and other changes bundled in B prevent assigning the difference to one isolated change. “Prompt-only” means no extra assessment pass; it does not mean only prompt text changed.

Compiled hashes before/after identify the unchanged executed B build. `sourceHashes` identify working-tree files observed at run start; later source-only edits were not compiled into this running application. Without a build-time source manifest, those fields must not be presented as proof that current sources produced the executable snapshot. Raw results remain unchanged.
