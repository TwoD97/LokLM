# Final context allocation

`context_budget::plan` ports the original standalone/basic/checked context
allocator. It reserves the longest supported system contract, output allowance,
model framing margin, optional cached overview, contiguous recent history and
complete evidence passages. Pinned documents share an allowance with round-robin
candidate selection; unused pinned capacity returns to retrieved evidence.
Primary hits precede expansion hits, duplicate identities appear once, and whole
passages are removed from the tail until the fully rendered candidate fits.

For checked answers, every candidate builds a complete immutable context bundle.
The final bundle retains its exact prompt, system contract, ordered schema and
owned source catalog after packing. History, cached summaries and codebase mode
are rejected in this standalone checked route, matching the original behavior;
they are never silently discarded. Basic mode retains their original allocation.
Oversized cached summaries are omitted as whole optional blocks, never clipped.

`ContextHit` retains the complete incoming retrieval JSON record alongside its
typed prompt fields. Selected scores, ordinals, origin fields and unknown metadata
survive allocation. The common passage packer now applies exact JavaScript
whitespace and treats an empty origin like the original missing/primary origin.
Those are narrow corrections to existing default behavior and need explicit
adapter regression when downstream consumers adopt this commit. No embedding
numeric representation, model weights, database or index fingerprint changes.

The original context-budget and checked-answer tests plus synthetic boundary
cases pass 31 tests and record 43 complete allocations/rejections. Rust compares
all retained metadata/history, summary framing, token estimates, fit flags and
checked bundle schemas/prompts. It also checks caller mutation cannot alter a
final plan and every selected checked source resolves through the same catalog.
A separate guard refuses a provider window too large for the platform integer,
rather than silently saturating it. Existing history clipping still avoids lone
surrogates, as documented in the earlier prompt port.

This is estimated allocation, not actual tokenizer admission or authorization.
The native inference boundary must verify the exact chat template plus prompt and
output allowance against its real window before evaluation. Callers must scope
retrieval and recheck session/cancellation before generation, publication and
source access. These APIs do not activate structured desktop generation or prove
semantic acceptance; existing model evidence remains tied to its earlier artifact.

## Manual testing

1. Run `pnpm exec vitest run --config native/scripts/context-fixtures.config.ts`.
   Expect 31 passing tests and regenerated synthetic allocation fixtures.
2. Run `cargo test -p loklm-core --no-default-features --test context_budget_compat --manifest-path native/Cargo.toml`.
   Expect all 43 allocations/rejections and the unrepresentable-window guard to pass.
3. Inspect the tight-window, duplicate-pin, oversized-summary, long-history,
   metadata and checked-short-answer fixtures. Whole passages/optional summaries
   drop deterministically; retained records keep their fields; checked mode rejects
   incompatible context instead of discarding it. A fit estimate alone never
   authorizes model evaluation or access to a locked workspace.
