# Prompt-only C: authority DEV application review

Eight requests were observed: seven completed answers and one empty cancelled request. Independent review finds three fully supported answerable responses, two complete safe abstentions, one citation-related partial response, one incorrect code response, and one operational failure with no answer to judge. The run failed overall. It is not an eight-case success.

| Case                           | Independent result        | Exact finding                                                                                                                       |     Total |
| ------------------------------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------: |
| 01 competing counts            | Safe abstention, complete | Preserves 980/1040, both dates and missing final approval; correct 1:1/2:2 citations                                                | 154.378 s |
| 02 approved retention revision | Partial citation support  | Correct current21 days and supersession, but added old14 days cites only4:4; that value exists only in3:3                           | 126.534 s |
| 03 newer unapproved proposal   | Supported                 | Current approved12 versus proposed18 correctly distinguished and cited5:5/6:6                                                       | 128.613 s |
| 04 different scope and time    | Supported                 | West2027=2400EUR and East2028=3500EUR correctly coexist, each correctly cited                                                       | 133.128 s |
| 05 equivalent units            | Supported                 | Correct equality of2.75kg and2750g, with exact9:9/10:10 support                                                                     | 103.681 s |
| 06 missing phone               | Safe abstention, complete | Does not invent a number; optional email/address are supported by11:11                                                              |  71.594 s |
| 07 competing code branches     | Incorrect                 | Says BranchB result7 while the same sentence correctly explains false condition and return3; deployment uncertainty is also omitted | 174.079 s |
| 08 agreement                   | Operational failure       | Empty cancelled terminal during prefill; invocation rejects with LockedError:locked                                                 |  31.020 s |

The code failure is not a regex or formatting failure. The prominent BranchB result contradicts both the source and the answer's own explanatory clause. BranchA7 is correct. Both chunks are supplied, so the failure cannot be attributed to absent retrieval evidence. It completed below both the current300-second limit and the historical180-second limit.

The last cancellation was not operator-requested (confirmed by the run owner). It occurred about15 minutes after isolated-session activity, consistent with the application's default idle lock. Both agreement passages14:14 and15:15 had been supplied; no final answer was generated. The query recorded timedOut=false, terminalOutcome=cancelled and a settled invoke error. This stays an operational failure even if a separately named follow-up later succeeds. Subsequent isolated harness runs explicitly set and record autoLockMinutes=0; production defaults are unchanged.

Median total time for all eight observations, including the cancelled one, is127.5735seconds. For the seven completed answers alone it is128.613seconds; their median first visible token time is45.5seconds. These small-sample descriptive figures include each request's retrieval and model transitions. They are not controlled speed comparisons to a single two-source utility call.

Assessment was disabled. Requested and recorded context were8192 tokens. The per-question limit was300seconds, unlike the original180-second baseline. Both before/after build provenance matched compiled C. Working-tree files changed after that build, which is explicitly recorded; current-source hashes must not be substituted for C's build-time inputs. The raw report remains unchanged, and manual.json/review.json contain the per-observation semantic and transport checks.
