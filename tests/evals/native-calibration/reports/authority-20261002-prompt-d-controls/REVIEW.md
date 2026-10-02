# Prompt-only D controls: observed results and profile confound

Three deliberately selected requests completed. Independent assistant-agent review finds two supported answers and one incorrect code answer. The other five DEV cases were intentionally unrequested in this run; they are not silently counted as successes or failures.

| Case                           | Result    | Finding                                                                                                                               |     Total |
| ------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------: |
| 02 approved retention revision | Supported | Correct current 21 days and old 14 days, with proper 4:4 and 3:3 attribution and effective replacement                                | 171.121 s |
| 07 competing code              | Incorrect | Opening says both branches return 7, then later reasoning and final bullets correctly give A=7/B=3; deployment uncertainty is omitted | 130.464 s |
| 08 agreement                   | Supported | Correct endpoint and UTF-8 JSON, with exact quotations from 14:14 and 15:15                                                           |  98.167 s |

The correct final bullets in case07 do not erase the contradictory first answer. Matching expected values somewhere in the response is not enough. No subsequent prompt repair or automatic fact retargeting has been applied to these observations.

These are valid observations from compiled D with assessment disabled, but **not a clean assessment-only A/B** against the assessed D run. All three record FULL before and after generation; the assessed run records LITE throughout. D's implementation maps those profiles to thorough versus standard answer-depth instructions, despite the same 4B model, actual 8192-token context and 14 GPU layers. This depth mapping is inferred from the implementation and profile snapshots; final system-prompt strings are not directly captured. KV precision is q8_0 for cases02/07 and q4_0 for case08, and also differs across prior runs.

Median total latency is 130.464 seconds for these three selected requests. There were no timeouts, error terminals or cancellations. Before/after compiled provenance matches D; later unbuilt capacity-related source edits do not change which compiled implementation produced these answers. All raw output, snapshots and failures remain intact alongside manual.json and derived review.json. The capacity-aware E build is a separate candidate and must be evaluated separately before reserved publication.
