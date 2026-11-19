# Source-linked exact unit arithmetic

`loklm_core::source_quantities::annotate(&[QuantityPassage])` ports the original
`qa/sourceQuantities.ts` pure annotation helper. Input IDs must be positive
JavaScript-safe integers. Output catalog IDs are per result, never stable source
identities. Start/end are UTF-16 offsets into the intact original passage.

It recognizes the original explicit English/German duration, length, mass and
volume units, including comma decimals with one or two fractional digits. It
declines ambiguous grouping, signed/approximate/range notation, currency-adjacent
symbols, rates and compound units. No locale or unsupported unit is inferred.
Numerators, denominators and values are strings: bounded u128 rational arithmetic
preserves the original BigInt results without floating-point rounding. The
18-digit input limit and largest factor ensure all intermediates fit u128.

The original limits remain 16 passages, 16,000 UTF-16 units per passage, 64,000
total units, 32 quantities and 6,000 annotation units. Oversized passages are
skipped whole. Conflicting text under one source identity poisons that identity;
identical duplicate sources count once. `limited` reports resource exclusions,
not semantic completeness. Equal converted values do not establish shared scope,
authority, applicability or entailment.

The pinned [Rust regex crate](https://docs.rs/regex/1.13.2/regex/) uses bounded
linear-time searches without lookaround; Unicode boundaries are checked
separately. Patterns are fixed code, never document-supplied patterns. ECMAScript
whitespace and UTF-16 context windows preserve the original matching contract.

`native/scripts/quantity-fixtures.ts` evaluates the actual original helper on
307 synthetic cases, including notation cases taken from its existing unit tests,
Unicode/context combinations, duplicate/invalid sources and resource limits.
The Rust compatibility test compares complete output objects and original spans.
These helpers are not yet wired into desktop checked/comparison QA. There is no
new arithmetic or factual-support claim for the current basic answer API.

## Manual testing

1. Run `pnpm exec tsx native/scripts/quantity-fixtures.ts` from the repository root.
   Expect 307 original arithmetic fixtures, without models, network or personal data.
2. Run `cargo test -p loklm-core --no-default-features --test source_quantities_compat --manifest-path native/Cargo.toml`.
   Expect exact original output equality and intact UTF-16 source spans, including
   90 seconds versus 1.5 minutes, comma decimals and rejected ambiguous notation.
