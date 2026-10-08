# Rejected grounded-answer prototype

These modules are evaluation code, with no production imports. The October 5 C candidate did not meet the quality or latency bar and was not integrated into QA.

- `groundedAnswerPlan.ts` builds the bounded C schema and prompt.
- `groundedAnswer.ts` validates structure and exact quotation membership, then renders canonical citations. It does not establish semantic support or authority.
- `sourceQuote.ts` is a later, unintegrated whitespace-only anchoring experiment. It was not used to repair or regrade frozen C outputs.

The unit tests remain in `tests/unit`. The frozen C plan, outputs and recorded outcomes have not been rewritten. Original source bytes and replay requirements are documented in the [diagnostic source archive](../reports/bugfix-20261005-grounded-answer-diagnostic/source-archive/README.md).
