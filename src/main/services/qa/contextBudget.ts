import type { RetrievalHit } from '../../../shared/documents'
import {
  answerMaxTokens,
  buildPrompt,
  buildSummaryPreamble,
  buildSystemPrompt,
  CONTEXT_PACK_MARGIN_TOKENS,
  DEFAULT_CONTEXT_TOKENS,
  estimateTokens,
  hitTokenCost,
  packHistoryToBudget,
  packHitsToBudget,
  type HistoryMessage,
  type ResponseLanguage,
} from '../llm/prompt'

export const PINNED_BUDGET_MAX_TOKENS = 4096

export function pinnedBudgetTokens(totalBudget: number, pinnedCount: number): number {
  if (pinnedCount === 0 || totalBudget <= 0) return 0
  return Math.min(Math.floor(totalBudget * 0.4), PINNED_BUDGET_MAX_TOKENS)
}

export interface ContextPlanInput {
  contextTokens: number
  question: string
  language: ResponseLanguage
  codebase?: boolean
  history?: ReadonlyArray<HistoryMessage>
  hits: RetrievalHit[]
  pinnedGroups?: RetrievalHit[][]
  summary?: { title: string; summary: string } | null
}

/** One allocation for the exact passages/history later handed to inference.
 *  Token counts remain estimates; reserve the longest supported system prompt
 *  and explicit model framing slack rather than assuming the concise prompt. */
export function planAnswerContext(input: ContextPlanInput) {
  const contextTokens =
    Number.isFinite(input.contextTokens) && input.contextTokens > 0
      ? Math.floor(input.contextTokens)
      : DEFAULT_CONTEXT_TOKENS
  const maxTokens = answerMaxTokens(contextTokens)
  const inputLimit = contextTokens - maxTokens - CONTEXT_PACK_MARGIN_TOKENS
  const systemTokens = estimateTokens(
    buildSystemPrompt(input.language, 'thorough', {
      codebase: input.codebase ?? false,
    }),
  )
  const fixedTokens =
    systemTokens + estimateTokens(buildPrompt(input.question, [], [], input.language))
  let summary = input.summary ?? null
  // A cached overview is optional. If it would consume most of the remaining
  // window, fall back to original source excerpts rather than slice its claims.
  if (summary) {
    const cost = Math.max(
      estimateTokens(buildSummaryPreamble(input.language, summary.title, summary.summary, true)),
      estimateTokens(buildSummaryPreamble(input.language, summary.title, summary.summary, false)),
    )
    if (cost > Math.max(0, (inputLimit - fixedTokens) / 2)) summary = null
  }
  const preamble = (hasExcerpts: boolean): string | undefined =>
    summary
      ? buildSummaryPreamble(input.language, summary.title, summary.summary, hasExcerpts)
      : undefined
  const summaryReserve = summary
    ? Math.max(estimateTokens(preamble(true)!), estimateTokens(preamble(false)!))
    : 0
  const history = packHistoryToBudget(
    input.history,
    Math.max(
      0,
      Math.min(
        2048,
        Math.floor(contextTokens / 8),
        Math.floor((inputLimit - fixedTokens - summaryReserve) / 4),
      ),
    ),
  )
  // Account for all rendered framing, plus a separate pinned section header.
  const baseTokens =
    systemTokens +
    estimateTokens(buildPrompt(input.question, [], history, input.language, [], preamble(true)))
  const evidenceBudget = Math.max(0, inputLimit - baseTokens - 32)
  const groups = (input.pinnedGroups ?? []).filter((group) => group.length > 0)
  const pinnedBudget =
    input.hits.length === 0
      ? Math.min(evidenceBudget, PINNED_BUDGET_MAX_TOKENS)
      : pinnedBudgetTokens(evidenceBudget, groups.length)
  // One passage per document before a second passage from any document. A
  // per-document fractional budget can reject EVERY passage when many docs
  // are pinned even though several whole passages fit the shared allowance.
  const pinnedCandidates: RetrievalHit[] = []
  const rounds = Math.max(0, ...groups.map((group) => group.length))
  for (let i = 0; i < rounds; i++) {
    for (const group of groups) {
      if (group[i]) pinnedCandidates.push(group[i]!)
    }
  }
  let pinnedHits = packHitsToBudget(pinnedCandidates, pinnedBudget, input.language)
  const pinnedKeys = new Set(pinnedHits.map((h) => `${h.document_id}:${h.chunk_id}`))
  const usedPinned = pinnedHits.reduce((sum, h) => sum + hitTokenCost(h, input.language), 0)
  // Reclaim unused pinned capacity; duplicate excerpts are supplied only once.
  let hits = packHitsToBudget(
    input.hits.filter((h) => !pinnedKeys.has(`${h.document_id}:${h.chunk_id}`)),
    Math.max(0, evidenceBudget - usedPinned),
    input.language,
  )
  const renderedCost = (): number =>
    systemTokens +
    estimateTokens(
      buildPrompt(
        input.question,
        hits,
        history,
        input.language,
        pinnedHits,
        preamble(hits.length + pinnedHits.length > 0),
      ),
    )
  // Verify the complete rendered prompt after selection, not only chunk sums.
  // Expansion hits are last, so they are the first removed if framing differs.
  while (renderedCost() > inputLimit && (hits.length || pinnedHits.length)) {
    if (hits.length) hits = hits.slice(0, -1)
    else pinnedHits = pinnedHits.slice(0, -1)
  }
  const promptTokens = renderedCost()
  return {
    contextTokens,
    maxTokens,
    history,
    pinnedHits,
    hits,
    contextPreamble: preamble(hits.length + pinnedHits.length > 0),
    promptTokens,
    fits: promptTokens <= inputLimit,
    summaryOmitted: !!input.summary && !summary,
  }
}
