# Synthetic native indexing PDF

Generate a separate deterministic fixture for live indexing progress and cancellation checks:

```powershell
node tests/e2e/fixtures/generate-indexing-pdf.mjs
pnpm.cmd exec tsx tests/e2e/fixtures/verify-indexing-pdf.ts --render
```

The PDF is written to `out/native-indexing/indexing-workflow.pdf`; set `LOKLM_TEST_PDF` to its absolute path for `tests/e2e/indexing-native.spec.ts`. The generator takes an optional first argument to choose a different output PDF. When verifying a custom path, pass that path first and `--render` afterward.

The fixture contains 20 pages of invented operations records with unique location and record identifiers. It has a real PDF text layer, uses only Node built-ins for serialization, and is byte-identical across generations. The verifier uses the production PDF parser and default 2,000-character/200-character-overlap chunker; it checks each page's first and last paragraph, page coverage, and a bounded 40–60 chunk count. Optional screenshots cover the first, middle and final pages.

Generation and verification load no inference models and use no vault. Neither script reads or changes development or held-out calibration sources. This fixture measures workflow behavior, not retrieval answer quality. Indexing duration depends on the active hardware and must be measured by the native test.
