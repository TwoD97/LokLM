# Local GPU RAG calibration fixtures

This is a small, hand-auditable synthetic sample for this application and hardware. It is not a general RAG benchmark and does not justify claims about unseen real libraries, scanned pages, charts, long documents, or other model families.

The original `dev` and `heldout` splits each contain six documents and twelve questions. Development and held-out files, entities, source keys, questions, and values are separate. Four documents are Markdown (including one fenced TypeScript example), one is text, and one is a genuine one-page PDF table. Code questions exercise code **as a library document**, not the structural code-workspace pipeline. All content is invented and contains no hidden instructions to the answering model.

Questions cover exact amounts and currencies, dates, cross-language retrieval in both directions, table values and units, simple arithmetic, comparisons requiring two sources, identifiers, code branches, missing facts, and conflicting drafts with no authority tie-breaker. Answers are requested in one short sentence to bound calibration latency. Every split has nine answerable cases, two missing-fact cases, and one conflicting-source case that requires explaining the unresolved conflict.

## Loading and running

`loadCalibrationSplit(split)` in `fixtures.ts` loads `dev.json`, `heldout.json`, or the separately labeled `conflict-regression.json` and returns source entries with an `absolutePath` ready to import. Source file paths in the JSON are relative to this directory. Use separate empty library workspaces per split and map each `source.key` to its imported document ID; never import different corpora into the same calibration workspace.

Tune only on development. Freeze settings, model identity/quantization, application build, prompt, and evaluation rules before opening the held-out results. Run the twelve held-out questions once for each final candidate. Any later adjustment based on their answers makes that set development data; do not present it as an untouched held-out validation. Repetitions used only for timing still need to be disclosed and must not be cherry-picked for answer quality.

The loader checks `heldout.sha256.json` against the exact manifest and all six source files. `generate-pdfs.mjs` creates missing deterministic PDF files or verifies existing identical bytes; it refuses overwrites. Its `--freeze-heldout` option initializes the lock once and subsequently verifies it. Changing held-out data requires an explicitly versioned replacement dataset, not silently refreshing the lock.

```powershell
node tests/evals/native-calibration/generate-pdfs.mjs
node tests/evals/native-calibration/verify-pdfs.mjs
pnpm.cmd exec vitest run --project unit tests/unit/native-calibration-fixtures.test.ts
```

The PDF generator uses built-in Node modules. Verification uses the existing `pdf-parse` dependency to extract text and render both pages under `out/native-calibration/fixtures`. There are no model downloads, new packages, network calls, or inference runs in fixture generation or validation.

For the native Windows/NVIDIA run, close LokLM first so the benchmark has the GPU, build once, and use a new run name. Installed GGUF files under `models/` and `nvidia-smi` are required. The launcher creates an isolated temporary vault even if the shell has a `LOKLM_DATA_DIR` override; it does not open the user's library.

```powershell
pnpm.cmd build
$env:LOKLM_NATIVE_RAG = '1'
$env:LOKLM_NATIVE_TRACE = '1'
$env:LOKLM_LLM_CONTEXT_SIZE = '8192'
$env:LOKLM_CALIBRATION_SPLIT = 'dev'
$env:LOKLM_CALIBRATION_RUN = 'my-dev-run'
$env:LOKLM_CALIBRATION_REPEATS = '1'
pnpm.cmd exec playwright test --config tests/e2e/playwright.config.ts native-rag-calibration
```

Start in a fresh shell or remove previous experiment overrides. Normal defaults enable the query-vector cache and guarded GPU-layer-plan reuse, choose a bounded native math-core thread count, retain the normal VRAM reserve, and disable experimental citation aliases. `LOKLM_QUERY_EMBEDDING_CACHE=0` and `LOKLM_REUSE_GPU_LAYER_PLAN=0` independently disable the two caches for controls. `LOKLM_INFERENCE_THREADS`, `LOKLM_VRAM_PADDING_MIB`, and `LOKLM_CITATION_ALIASES=1` are explicit diagnostic controls, not the selected production profile.

`LOKLM_CALIBRATION_CASES` selects comma-separated case IDs in that exact order. With repetitions greater than one, `LOKLM_CALIBRATION_WARM_CASES` can restrict subsequent repeats to selected IDs. Unset both filters for a complete split. A run directory cannot be overwritten. Freeze the build and configuration before changing the split to `heldout`; do not tune from its results and label a later retry untouched.

Each run retains `raw.json`, model/build/source hashes, actual extracted chunks, whole-GPU samples, and logs locally. These verbose generated traces are ignored by Git; compact `manual.json` and `REVIEW.md` are retained for review. Follow [the grading procedure](REVIEW.md) to evaluate actual claim support, including all failed cases. The [24 September calibration report](../../../docs/research/2026-09-24-native-calibration.md) records the selected defaults and their measured limits.

## Gold and assessment limits

`referenceAnswer` is the short human-readable key. `answerChecks` contains JavaScript regex patterns evaluated with `iu` flags; localized decimal/thousands punctuation and currency names are accepted. The ISO-date questions deliberately request ISO formatting. These checks help detect missing exact facts; they cannot establish entailment, correct negation, requested answer language, or absence of invented extras.

`requiredSourceKeys` identifies evidence needed for a complete answer. Both sources are required for comparisons and unresolved conflicts. Missing-fact cases have no mandatory citation: a safe refusal must not fail only because it lacks a citation for an absent fact. A conflict response should name both incompatible dates and avoid selecting one as definitive.

`expectedAbstention` is true for unavailable facts and unresolved conflicts. It permits a short supported explanation rather than requiring an empty answer. `allowPartial` is false throughout: naming only one comparison value or one side of a conflict is not a full success. A partial response may be recorded separately but cannot become a pass. All facts must be evaluated using the actual answer and inline citations, not the gold reference or retrieved passages alone.

Use [REVIEW.md](./REVIEW.md) and `report.ts` for mechanical checks plus independent manual semantic review. Report answer correctness, correct abstention versus answer coverage, citation support, evidence coverage after packing, and cold/warm latency including model swaps. Keep timed-out, truncated, failed, and unsupported answers in the denominator.

## Post-held-out conflict regression

`conflict-regression.json` was created after the frozen held-out run exposed an unsupported definitive deadline. It is an explicit development/regression set, **not another held-out validation**, and cannot erase or replace the original recorded failure. The original `dev.json`, `heldout.json`, source files, and held-out lock are unchanged.

Four small Markdown documents form two pairs. Arven's unapproved drafts disagree; B has a later issue date but no approval or supersession. Belvar's approved revision 2 explicitly supersedes revision 1 and its earlier deadline. Each pair is queried in English and German, for four questions total. Unresolved cases must preserve both dates with both exact sources and avoid a definitive choice; resolved cases must return the authorized final date with revision 2's exact citation. A blanket refusal fails the two answerable revision cases. The source documents contain ordinary revision facts, not instructions about how to answer the test.

Set `LOKLM_CALIBRATION_SPLIT='conflict-regression'`, choose a new `LOKLM_CALIBRATION_RUN`, and use the same native command above. Unset case filters and set repetitions to one. Grade using `--manifest tests/evals/native-calibration/conflict-regression.json`. Independently review the actual supplied passages and final claims: merely mentioning both dates does not prove the model preserved uncertainty, and a correct final date does not prove it cited the authority that resolves the disagreement.

## October 2 authority and scope challenge

`authority-dev-20261002.json` adds eight DEV questions over 15 short sources: five answerable and three requiring abstention from a definitive fact, balanced between English and German. Controls include approved replacement, newer unapproved proposals, different scope/time, equivalent units, agreement, missing evidence, competing numbers and code branches. They are diagnostic synthetic cases, not a representative quality estimate. See the [design and primary research](../../../docs/research/2026-10-02-authority-evaluation-design.md).

Use `LOKLM_CALIBRATION_SPLIT='authority-dev-20261002'` with a fresh run ID and the native command above. `LOKLM_CALIBRATION_QUESTION_TIMEOUT_MS` accepts 30000–600000, default180000; changing it must be disclosed in comparisons. `LOKLM_EVIDENCE_ASSESSMENT=1` enables the experimental path only when the built app supports it. Its actual planned/started/completed coverage and final answer outcomes matter more than the flag. The grader records cancellation, invocation errors, terminal disagreement and actual supplied passages; it never promotes partial text or matching regexes into verified success.

`LOKLM_EVIDENCE_ASSESSMENT` is **off by default** and is a developer diagnostic, **not recommended for daily use**. Enabling it does not imply safer answers: the [full D application review](./reports/authority-20261002-assessed-d-dev/REVIEW.md) found a false refusal on an answerable approved rule, irrelevant quoted passages, an unevaluated code question, and a median 73.844 seconds spent on assessment alone. There is no user-facing UI toggle. Keep failures and actual coverage visible when experimenting with this flag.

A separately authored `authority-reserved-20261002` split was held outside the shared fixtures until the explicit candidate E freeze, then published at 10:48:56 UTC on 2 October 2026 with its original mandatory byte-hash lock. All 16 locked datafile hashes were preserved, and all 17 files including the lock survived an isolated Git checkout with `core.autocrlf=true`. The seal and publication method are recorded in the [evaluation design](../../../docs/research/2026-10-02-authority-evaluation-design.md). Its exact contents were withheld from the tuning agents until freeze; any later tuning from its results converts it to development evidence. Do not substitute repeated DEV variants for reserved questions. Optional [build provenance](../../bench/build-provenance.md) records which frozen source inputs produced the compiled output; ordinary working-tree hashes alone do not establish that mapping.

`LOKLM_CALIBRATION_CONTINUE_ERRORS=1` optionally collects later cases after a received, unambiguous error terminal whose invocation has fully settled. It never continues after timeouts, cancellation, invoke rejection, missing or mismatched terminals. The option and each collection decision are recorded. If any request failed, the CLI still fails after collecting the remaining observations; errors never become successes. Default behavior stops on the first failure.

The isolated calibration vault now sets and records `security.autoLockMinutes=0`. API-only questions do not generate ordinary user activity, so the prior default 15-minute idle lock cancelled the last request of `authority-20261002-prompt-c-dev`. That original failure remains recorded; this harness setting prevents unrelated idle cancellation in later long runs and changes no application security default or user vault.
