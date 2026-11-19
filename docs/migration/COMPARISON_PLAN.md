# Typed comparison plan

`comparison_answer::ComparisonPlan` ports `typed-comparison-v32` from the current
canonical source. A plan owns its immutable all-fed catalog, ordered JSON schema,
format mode and program-produced arithmetic references. It admits at most 32
unique safe positive passage identities, 64,000 UTF-16 units per source and
256,000 in total. It never filters sources based on a question-specific guess.
Unknown prompt-source lookup returns `None`; caller mutation cannot alter a plan.

The parser rejects duplicate decoded JSON keys, invalid envelopes, late `check`,
reordered ordinary `text`/`sources`, unknown references and hidden/injected markers.
Ordinary answers use the shared bounded record renderer. Short unresolved conflict
answers use the original ordered summary contract and exact-fragment renderer.
Full comparisons select one to four complete original passages and retain the
original compatible/unresolved/insufficient reporting text in English or German.
Source text is escaped, never silently clipped or substituted. Selected source
quantities and code-call results are attached from the existing program-produced
references after original-span verification; model-supplied derivations are refused.

Generated ordinary output respects its caller's 1–32,000-character allowance.
Complete source display has the original independent 32,000-UTF-16-unit render
bound; short conflict reporting retains its smaller scalar allowance. Input JSON
retains the 256,000-UTF-16-unit transport cap and the ordered parser's explicit
additional strict Unicode/finite-number/nesting constraints. Rejections contain
only typed structural categories, with separate ordinary/comparison detail.

The unchanged original comparison-answer, answer-format, conflict-summary and
comparison-summary suites pass 175 tests. Captured fixtures cover 199 plan
admissions and 235 parser attempts, exact schema serialization order, complete
outputs/derivations and rejection details. Rust also verifies every catalog
lookup and that caller-side source mutation cannot affect an admitted plan.
One invalid-surrogate attempt rejects at the earlier JSON transport boundary;
one original mocked citation-finder failure is covered by the private conflict
renderer fault test instead of comparing against an unmodified finder.

This is a structural plan, not full checked-QA orchestration. It does not establish
the correctness of model-chosen outcomes, source relevance, claim support or
complete requested coverage. Checked prompt/context budgeting, native constrained
generation, semantic acceptance/evaluation and desktop routing/UI integration
remain pending. The current basic answer path and its measured executable/model
artifacts are unchanged; no new model or performance result is claimed.

## Manual testing

1. Run `pnpm exec vitest run --config native/scripts/comparison-fixtures.config.ts`.
   Expect all 175 original tests and regenerated synthetic plan/parse fixtures.
2. Run `cargo test -p loklm-core --no-default-features --test comparison_answer_compat --manifest-path native/Cargo.toml`.
   Expect exact schemas, source snapshots, full/short outputs, arithmetic and
   rejection details to match, with the documented Unicode/fault-test boundaries.
3. Inspect original fixtures for unknown/duplicate IDs, escaped duplicate JSON
   keys, unsafe bounds, reversed record order and source text containing Markdown
   or fake marker examples. Invalid records reject; source text remains literal.
   Do not treat an accepted model outcome as proof of entailment or authority.
