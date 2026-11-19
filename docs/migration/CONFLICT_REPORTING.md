# Evidence-bound conflict reporting

`answer_format` ports the original conservative EN/DE final single-sentence
imperative detector and source Markdown escaping. Possible quoted/code/HTML/math
instructions decline the shorter format. Source escaping retains characters while
making source-authored Markdown/HTML and citation syntax inert, including leading
indentation and CR/LF combinations. Format eligibility is not a sentence counter.

`conflict_summary` ports the original unresolved-alternatives reporting grammar:
one to three scope fragments, two to four labelled alternatives, and one to three
documentary issues with one to four evidence fragments each. It accepts only exact
source fragments/excerpts through the existing immutable matchers, supports the
original complete leading-heading selector, rejects duplicate alternatives/issues
and limits selected sources to four. The program supplies DE/EN reporting text,
escapes source text, attaches supplied identities and verifies visible marker
positions. Output remains bounded to 512 Unicode scalars or the smaller caller
budget. Selected and displayed spans retain original UTF-16 positions.

The schema preserves original property order. `ordered_json` keeps ordered members
and rejects duplicate **decoded** keys, including escaped aliases, without changing
global serde_json features or provider/index serialization. Its transport bound is
256,000 UTF-16 units, with serde's additional nesting ceiling and strict Unicode/
finite-number decoding. These are fail-closed transport constraints; Rust strings
cannot hold lone UTF-16 surrogates. The enclosing comparison plan must still bound
and authenticate its immutable source catalog, validate source identities and
enforce the full envelope, route, language and semantic acceptance rules.

The unchanged original answer-format, conflict-summary and comparison-summary
tests plus small boundary probes pass 95 tests. They record 529 calls: 139 format
decisions, 196 source escapes, 14 block quotations, 92 schemas and 88 summary
attempts. Rust compares the exact serialized schema order, wording, spans and
rejection categories. One deliberately unpaired-surrogate input is rejected at
Rust's earlier JSON boundary rather than the original fragment check. One original
test mocks the citation finder to return no visible markers; a private Rust
fault-injection test reproduces that failure without exposing an override in the
production API. The remaining reference calls match directly.

Exact origin does **not** establish that a chosen label/value/scope belongs
together, that all qualifiers or alternatives were retained, or that a selected
issue is supported. The original tests intentionally demonstrate this distinction.
No runtime entailment, semantic injection immunity or full QA parity is claimed.
These helpers and the ordered parser are not yet connected to desktop generation;
existing model/executable measurements retain their earlier artifact provenance.

## Manual testing

1. Run `pnpm exec vitest run --config native/scripts/conflict-fixtures.config.ts`.
   Expect 95 passing original/boundary tests and regenerated synthetic fixtures.
2. Run `cargo test -p loklm-core --no-default-features --manifest-path native/Cargo.toml`.
   Expect exact conflict/format/escape/schema comparisons, source-span checks,
   duplicate-key/nesting/Unicode rejection and injected visibility-failure rejection.
3. Review `tests/unit/conflict-summary.test.ts` and `comparison-summary.test.ts`
   with the captured fixture. Complete source headings retain their original spans;
   invented evidence, reordered fields, repeated alternatives, hidden markers and
   over-budget rendered summaries reject. Exact but semantically misleading
   selections remain a separate checked-QA acceptance responsibility.
