# Post-held-out conflict regression review

This four-question regression set and the generic conflict-policy change were created **after** the frozen held-out run failed its conflict question. This is post-held-out development, not another untouched held-out validation. The original recorded failure remains unchanged and cannot be replaced by this result.

The four small documents form two independent pairs: unapproved Arven drafts with different proposed deadlines, and Belvar revisions with explicit approval/supersession establishing a final deadline. Each pair is asked about in English and German. All four original passages were supplied intact in every native query.

**All four answers make the intended core authority decision:** neither unresolved query selects a definitive deadline, and both authorized queries return the correct final deadline rather than refusing indiscriminately. **This is not four fully compliant answers.** Evidence completeness, marker placement, and requested formatting still fail on individual cases.

| Case                  | Authority decision                                             | Exact evidence and instruction compliance                                                                                                              |
| --------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 01 English unresolved | Safe: no definitive deadline.                                  | Both ISO dates and both exact draft citations 1:1/2:2; source status explained correctly. Complete response.                                           |
| 02 German unresolved  | Safe: no definitive deadline.                                  | Omits both requested dates and cites only B while describing both drafts. **Incomplete evidence response.**                                            |
| 03 English authorized | Correct final 2028-04-27; authoritative revision 4:4 is cited. | Places old revision 3:3 immediately after the supersession clause, although that relationship is established in 4:4. **Partial citation attribution.** |
| 04 German authorized  | Correct final April 27, 2028; explicit supersession supported. | Final date cites 4:4; old date/replacement cite 3:3 and 4:4. **Requested ISO format and one-sentence limit are violated.**                             |

The positive authority controls matter: merely refusing whenever sources differ would fail cases 03 and 04. They distinguish recognizing an explicit resolving revision from always withholding an answer. The unresolved German answer also shows why safe uncertainty alone is not a complete response when both differing values and sources were requested.

Case 03's selected final date is supported by the authoritative source, but its separate supersession clause carries an unsupported immediate marker. Every asserted fact exists in supplied evidence; that does not make every inline attribution correct. These dimensions are retained separately in `manual.json`, rather than inflating a single pass count. Only case 01 fully meets this small regression set's strict evidence and output requirements.

All four queries recorded terminal events with no timeout or inference error. Actual allocations remain 8,192-token context and 14 of 33 GPU layers. Model objects/hashes match the frozen held-out run. The compiled main application changed for the post-held-out prompt/UI work; the compiled models worker hash is unchanged. This is not a controlled same-build quality replication.

Conventional median time to first token event and first visible text is 35.2145 s; median terminal-event time is 69.329 s. Startup is 43.518 s and indexing 8.113 s. Sampled whole-card GPU usage peaks at 3,269 MiB on the 4,096 MiB card. Four observations, different questions, and shorter source context do not support a general latency claim or comparison with the earlier twelve-case aggregate.

This run provides narrow evidence that the revised instruction can preserve unresolved status while accepting explicit authority in both languages. It does not establish reliable conflict resolution, eliminate the known multi-source passage-attribution problem, or establish general production accuracy. Further evaluation should use newly frozen independent data after changes are settled; the old held-out set has now informed development and must not be relabeled untouched.
