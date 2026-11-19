# Source-linked bounded numeric interpretation

`loklm_core::source_calculations::annotate(question, passages)` ports the pure
original `qa/sourceCalculations.ts` helper. It interprets complete, straight-line
JavaScript/TypeScript function declarations from direct source files or closed
language-tagged Markdown fences. It never executes JavaScript, imports modules,
calls document functions, or accesses files/network/processes.

Supported expressions are finite numeric literals and explicit parameters,
parentheses, unary signs, arithmetic operators, and the original whitelist of
Math min/max/abs/floor/ceil/round/trunc. Questions must provide literal calls or
unambiguous named literal inputs. Ambiguous bindings, surrounding code, shadowed
Math, comments in expressions, duplicate declarations, implicit return newlines,
unsupported syntax and non-finite results are omitted. Source IDs, unchanged
declaration text and UTF-16 offsets accompany every result; no deployed-version
or authority decision follows from a result.

Limits match the original: 4,096 question units, 16 passages of 16,000 UTF-16
units, 16 results, four parameters, 700 expression units, 256 tokens and depth 24.
The numeric interpreter uses IEEE-754 binary64, including JavaScript's rounding
and signed-zero behavior. JSON decoding enables serde_json `float_roundtrip`:
the edge fixture `0.9999999999999999` otherwise decoded as `1.0` in the previous
default decoder. Original source strings are never rewritten to calculate.

The fixture harness runs all 137 actual upstream arithmetic tests and records
their helper calls, plus deterministic floating-point and line-boundary cases.
The Rust test matches all 364 complete original result objects, annotations and
source spans. No model is involved. This module remains a prerequisite for the
pending checked/comparison QA integration; basic desktop generation does not yet
use it or claim factual validation.

## Manual testing

1. Run `pnpm exec vitest run --config native/scripts/calculation-fixtures.config.ts`.
   Expect 138 tests, including the unchanged upstream suite, and regenerated
   synthetic original fixtures. This explicit config does not load personal data.
2. Run `cargo test -p loklm-core --no-default-features --test source_calculations_compat --manifest-path native/Cargo.toml`.
   Expect complete original equality, including ambiguous-input refusals, Unicode
   spans, decimal edge values, signed zero and preservation of source text.
