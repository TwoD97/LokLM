# 11-thread control: independent review

Two distinct questions (03 approval date and 11 code clamp) were asked once and repeated once. All four answers are correct with exact supporting passage citations, and their text matches the six-thread run. This checks consistency for two cases; it is not another full development or held-out run.

Both compiled application hashes (`out/main/index.js`, `out/main/modelsWorker.js`), model hashes, and extracted chunk objects match `dev-8k-balanced`. Checkout source-file hash maps differ because development continued without rebuilding the control application. The compiled artifacts, not the mutable checkout, identify the program that ran.

| Case / repetition | Six threads: first visible / total | Eleven threads: first visible / total |
| ----------------- | ---------------------------------: | ------------------------------------: |
| 03 first pass     |                  62.391 / 78.000 s |                     59.545 / 81.844 s |
| 11 first pass     |                  66.133 / 78.815 s |                     63.580 / 78.082 s |
| 03 repeat         |                  21.927 / 41.813 s |                     20.580 / 45.486 s |
| 11 repeat         |                  22.218 / 35.597 s |                     23.701 / 42.099 s |

Six threads had lower whole-answer time in three of four observed pairs, including both repeats. First-visible latency is mixed: eleven threads reached visible output sooner in three pairs. The two-repeat total median is 38.705 s for six threads versus 43.7925 s for eleven. That is a descriptive result from two observations, not a stable or universal percentage speedup.

This control is not fully state-matched or randomized. Case 03 is first after indexing in the eleven-thread run but second after case 02 in the six-thread run; prior GPU residency can differ. Both repeat sequences use 03 then 11, making the second warm pair better matched, but still only one measurement each. No statistical significance or general hardware optimum is established.

All observations retained actual 8,192 context and 14/33 GPU layers. All terminal events were observed; there were no recorded timeouts or error events. The remaining exact-passage citation failure on case 06 was **not rerun** in this two-case control and remains unresolved.

Per-answer reasoning is in `manual.json`; `review.json` separates the two first-pass cases and their repeats and lists the ten unobserved development cases.
