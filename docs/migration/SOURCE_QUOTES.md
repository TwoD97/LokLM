# Shared source-quote provenance

`loklm_core::source_quote` ports the actual original `sourceQuote.ts` and
`sourceQuoteResolver.ts` contracts from `4651557`. This is pure Rust and works
with `default-features = false`; it opens no vault, file, socket or model.

- `anchor(source, proposed)` allows only ECMAScript whitespace collapse and
  boundary trimming. It preserves original text and flags overlapping/repeated
  matches. No case, punctuation, Unicode normalization or ellipsis repair.
- `expand_context(source, anchor)` expands to a bounded enclosing paragraph,
  preserving CRLF and conditions. Fenced code, multiple paragraphs and oversized
  contexts keep the original anchor. Invalid/forged offsets fail.
- `byte_range(source, anchor)` verifies the original quote and safely converts
  the legacy UTF-16 offsets to a Rust UTF-8 byte range; split surrogate offsets
  fail rather than selecting neighboring text.
- `QuoteResolver::new(&[QuoteSource])` snapshots at most 32 supplied passages,
  with positive safe-integer document/chunk IDs and bounded text. `resolve`
  checks the complete catalog, so a matching phrase in another passage or a
  repeated location is ambiguous even if the model chose an ID. Cache entries
  and returned spans are owned copies; cache capacity is 128.

Source text is limited to 64,000 UTF-16 units per passage / 256,000 per catalog;
quotations to 200 Unicode scalar values and expanded contexts to 800. The module
retains the original UTF-16 `start`/`end` wire contract. Rust strings cannot
contain unpaired surrogates; callers must reject invalid source encoding.

The actual TypeScript functions generate `original-source-quotes.json` through
`native/scripts/quote-fixtures.ts`. Rust compatibility tests compare 24 anchor
and context cases and 11 catalog scenarios, including emoji, BOM/NBSP, CRLF,
overlapping matches, overlong whitespace spans, duplicate identities, empty or
oversized catalogs and ambiguous sources. A second test checks byte conversion
and cache mutation isolation.

This does **not** prove relevance, entailment, applicability, approval or factual
truth, and it does not replace vault/workspace authorization. Structured checked
QA, quantities/calculations, routing and generation integration are separate
migration steps. No production answer is silently upgraded to “verified” merely
because this helper accepts its quotation.
