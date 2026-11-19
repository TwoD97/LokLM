# Exact source display fragments and excerpts

`source_fragments::FragmentMatcher` owns an immutable source string and lazily
caches ICU4X grapheme boundaries. `match_fragment` and `match_excerpt` return the
first valid original occurrence, with an ambiguity flag only when another valid
occurrence exists. Results retain exact text and UTF-16 offsets. The API reports
only `display`, `missing` or `boundary` on rejection, never rejected source text.

The original checks prevent cutting a grapheme, word, joined name, numeric sign,
currency decoration, comparator, decimal or compound numeric expression. Display
fragments retain strict original punctuation rules. An excerpt may include one
terminal ASCII full stop; its selected and displayed spans must validate at the
same occurrence, with the display omitting exactly that stop. No whitespace,
Unicode or punctuation is repaired. Terminal abbreviations remain conservative
refusals. Complete captured filename titles have the original explicit exception.

The original 157 unit tests supply 227 recorded calls, including fixed diagnostics,
throwing diagnostics sinks, emoji/combining marks, repeated occurrences, complete
numbers and punctuation. Rust matches full objects and rejection categories and
checks every source span. UTF-16 arrays preserve invalid-surrogate test inputs in
the fixture file; Rust/JSON IPC rejects those non-UTF-8 strings at decoding rather
than constructing an invalid Rust string. No document text is executable.

The enclosing evidence catalog must still bound source counts/lengths and enforce
vault/workspace access. Exact substring membership does not prove that a selected
fragment retained all qualifiers, is relevant or supports a claim. These pure
helpers are not yet wired into desktop structured comparison generation.

## Manual testing

1. Run `pnpm exec vitest run --config native/scripts/source-fragments-fixtures.config.ts`.
   Expect all 157 original synthetic tests and regenerated fixture calls, with no model.
2. Run `cargo test -p loklm-core --no-default-features --test source_fragments_compat --manifest-path native/Cargo.toml`.
   Expect all 227 cases to match, including grapheme/numeric boundary rejection,
   first valid occurrence, ambiguity and matching selected/display excerpt spans.
