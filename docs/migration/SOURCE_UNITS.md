# Immutable complete source units

`loklm_core::source_units::create(&[UnitPassage])` ports the original source-unit
catalog. The owned result exposes immutable `units()`, `get(id)` and
`prompt_source_text(document_id, chunk_id)` accessors. Caller mutation cannot
change the captured catalog. Unit IDs belong to that result only. Unknown IDs
return `None`; bad input fails the whole catalog with a fixed failure category.

Prose uses pinned Rust [ICU4X sentence segmentation](https://docs.rs/icu_segmenter/2.4.0/icu_segmenter/struct.SentenceSegmenter.html)
with the original fixed English locale. Code-file passages, fenced blocks,
tables, headings, list/quote continuations and abbreviation-ambiguous blocks
stay intact. The labelled prompt inserts `[U…] ` labels without replacing or
excluding any original character. Returned start/end positions are UTF-16
offsets, matching the original TypeScript API. Adjacent qualifications remain
available; no independently selected sentence is certified complete or true.

Limits match the original: 32 unique source identities, 64,000 UTF-16 units per
source, 256,000 total and 256 display units. Invalid/duplicate IDs, blank or
oversized sources and excess units fail the entire catalog. The segmentation
version is `loklm-0.7.4-icu4x-2.4.0-en-v1`. ICU data is compiled locally, with no
download or network at runtime and no LSTM/auto feature. No inference model runs.

The actual original helper on Node 24.17.0 / ICU 78.3 / Unicode 17.0 supplies 102
fixtures. These include all 13 original unit tests and DE/EN, Unicode line breaks,
emoji, abbreviation and structured-text cases. Rust matches complete unit lists,
failure categories and byte-preserving labelled text. This is fixture coverage,
not proof of every ICU boundary across all languages or versions. Broader Unicode
segmentation conformance remains a validation gate before changing pinned data.

The helper is not yet wired into desktop checked QA. It adds no factual-support
or relevance guarantee to current answers.

## Manual testing

1. Run `pnpm exec vitest run --config native/scripts/source-units-fixtures.config.ts`.
   Expect 14 tests and synthetic fixtures recording the actual Node/ICU versions.
2. Run `cargo test -p loklm-core --no-default-features --test source_units_compat --manifest-path native/Cargo.toml`.
   Expect all 102 catalogs to match, including exact labelled text, unchanged
   code/list blocks, source-span integrity and ownership after caller mutation.
