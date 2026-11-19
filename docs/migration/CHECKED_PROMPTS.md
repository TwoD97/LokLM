# Checked-context contracts

`checked_answer::ContextBundle` owns the exact prompt text, static system contract
and optional immutable `ComparisonPlan`. It builds the catalog in pinned-then-RAG
order and preserves original passages and identities. Quantity/code annotations
are appended from the existing pure arithmetic helpers, followed by the original
512-character summary allowance when applicable. Internal sentence-unit labels
never enter the prompt. Empty/duplicate/oversized catalogs leave the plan absent;
the eventual structured route must decline generation in that state.

Four system contracts and four instruction footers are captured verbatim from
the canonical TypeScript implementation. English/German full and short-summary
modes retain their complete original wording. Source/footer-like text is copied
as evidence and never removed with a string-replacement heuristic. The existing
`qa::build_prompt` API continues to select marker output by default; the new
`build_prompt_with_output` chooses structured output explicitly. Its evidence
presence check now uses exact JavaScript whitespace, including BOM and excluding
U+0085, as verified against the original function.

Twenty original/boundary tests capture 81 comparisons: four system contracts,
eight checked prompts, seventeen immutable bundles, ten output limits and 42
general prompt cases covering all three output modes and Unicode boundaries.
The original canonical prompt fixtures remain active. The legacy v1 diagnostic
answer parser is not implemented as a production fallback.

This bundle does not perform token admission, load a model, expose raw structured
output to the UI or certify semantic support. The full original context planner,
actual tokenizer/frame accounting, native schema-constrained generation,
checked-route admission and final semantic evaluation still require integration.
Keep the bundle intact after the final budget check; do not combine a schema,
prompt or source catalog from different plans. No new actual-model or executable
performance result is implied by these pure fixture comparisons.

## Manual testing

1. Run `pnpm exec vitest run --config native/scripts/checked-prompt-fixtures.config.ts`.
   Expect 20 passing tests and regenerated synthetic fixtures/checked prompt assets.
2. Run `cargo test -p loklm-core --no-default-features --test checked_prompt_compat --manifest-path native/Cargo.toml`.
   Expect exact contracts, passage/metadata order, arithmetic annotations, summary
   allowance and whitespace behavior to match all 81 recorded cases.
3. Inspect the duplicate-source and no-evidence bundle fixtures: the plan is absent.
   Check the literal fake-footer cases: source/question text remains intact, and
   only the actual appended contract supplies output instructions. This verifies
   construction, not immunity to semantic prompt injection.
