# Citation visibility and source-linked records

`citation_markers` ports the canonical `src/shared/citationMarkers.ts` scanner.
It distinguishes prose markers from code fences/spans, indented code inside list
containers, links and reference definitions, HTML/comments and bare URLs. It
retains invalid attempts for fail-closed validation; unknown/invalid identities
never become clickable references. Public spans refer to original UTF-16 units;
internal masks and slicing use valid UTF-8 boundaries. No source text is repaired.

The module also ports supplied-source reconciliation, reserved citation href
parsing, marker stripping/transformation and redundant `(doc:N:M)` label cleanup.
Cleanup preserves quoted examples, math and lazy blockquote continuations and
returns fixed structural rejection categories. Caller-supplied diagnostic
callbacks are replaced by typed results, so rejected text cannot enter a callback
or log through this API. Generic reconciliation preserves the original last-value,
first-position behavior when supplied keys repeat.

`source_linked_answer::render` accepts JSON records with exactly `text` and
`sources`, a supplied identity set and a maximum of 32,000 Unicode scalars. It
validates every raw reference (at most 32 per record), bounds original text before
cleanup, attaches canonical markers itself and checks their final identities and
UTF-16 positions. Markdown assembled across records cannot swallow a generated
marker or introduce an extra one. Sources remain ordered and deduplicated within
each record. Unknown identities, raw HTML, reserved hrefs, model-authored citation
syntax and hidden markers cause rejection, never an inferred source assignment.

This renderer operates on an already parsed JSON value. The future structured-QA
transport must reject duplicate raw JSON keys before parsing, bound input bytes,
apply the original route/schema/evidence checks, enforce workspace/session access
and buffer output until validation succeeds. Pure scanner callers must retain
their enclosing input bounds. Rust strings cannot represent lone UTF-16 surrogates.

The fixture harness executes the existing citation and source-linked-answer test
suites without changing their assertions, plus Unicode/numeric/math probes and
256 deterministic mixed-syntax probes. The resulting 261 tests record 5,108 calls
and exact outputs/rejection categories. Rust compares all outputs and verifies
reported marker spans. Standalone-CR/Unicode multiline anchors and escaped-dollar
regex backtracking are explicitly covered; simply using Rust's Unicode whitespace
classes or a greedy escape scanner changed the original results.

These are presentation/identity checks, **not claim-support, entailment or semantic
prompt-injection checks**. They are not yet wired into desktop structured answer
generation or the UI. The previously measured executable and actual-model evidence
remain separate artifact points; no new inference or performance result is implied.

## Manual testing

1. Run `pnpm exec vitest run --config native/scripts/citation-fixtures.config.ts`.
   Expect 261 passing tests and the regenerated synthetic fixture; no model runs.
2. Run `cargo test -p loklm-core --no-default-features --test citation_markers_compat --manifest-path native/Cargo.toml`.
   Expect all 5,108 reference outputs and fixed rejections to agree, including code,
   links, quoted labels, unsafe identities, Unicode spans and cross-record syntax.
3. Inspect the original source-linked test cases and corresponding fixture entries:
   a supplied plain-prose record receives a visible marker; an unknown source,
   unclosed code/math block or injected marker rejects. Literal examples retain
   their bytes. This helper does not change the current desktop UI behavior.
