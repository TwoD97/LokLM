# Canonical QA prompt snapshot

Generated from LokLM `4651557` (v0.7.4),
`src/main/services/llm/prompt.ts`, using
`pnpm exec tsx native/scripts/prompt-fixtures.ts`. These are the exact twelve
DE/EN × depth × document/codebase system prompts with citation alias and source
footer experiments disabled. Original LokLM MIT attribution applies. No model,
private data or credentials are used by the generator.

`qa` is a shared canonical-marker building block, not the complete QAService.
Callers scope retrieval before constructing `Passage`, reserve system/question,
history, generation and framing budgets, pack complete passages, then send only
those packed passages to `build_prompt` and `validate_citations`. Prompt token
estimates use the original UTF-16/3.5 heuristic; actual model tokenization is
still required to prevent context overflow. History truncation avoids creating
unpaired surrogates (a deliberate safety difference from JavaScript slice).

`validate_citations` resolves exact document/chunk pairs supplied in this turn;
it does not check factual entailment. Only its returned passages may become
source links, and source opening must re-check the active workspace/session.
An answer with missing/unknown identities is an error, never a fabricated source.
Raw stream text remains provisional. No-results should return `refusal` without
calling a model. Citation aliases, structured checked answers, claim verification,
comparison units, whole-corpus routing and cached-summary orchestration are not
implemented by this module and must remain explicit integration gates.

The `checked-*.txt` files are the four complete original checked system contracts
and their four instruction footers, captured with
`pnpm exec vitest run --config native/scripts/checked-prompt-fixtures.config.ts`.
`checked_answer::ContextBundle` pairs them with the immutable comparison plan and
original arithmetic annotations. Structured generation/routing remains pending;
these assets do not activate a model path or prove factual support. See
`docs/migration/CHECKED_PROMPTS.md` for fixture coverage and remaining boundaries.
