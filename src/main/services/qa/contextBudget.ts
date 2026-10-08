import type { RetrievalHit } from '../../../shared/documents'
import {
  buildCheckedContextBundle,
  buildCheckedPrompt,
  buildCheckedSystemPrompt,
} from './checkedAnswer'
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
  /** Standalone original-source answers compare before emitting visible text. */
  answerMode?: 'checked'
}

/** One allocation for the exact passages/history later handed to inference.
 *  Token counts remain estimates; reserve the longest supported system prompt
 *  and explicit model framing slack rather than assuming the concise prompt. */
export function planAnswerContext(input: ContextPlanInput) {
  const checked = input.answerMode === 'checked'
  if (checked && (input.history?.length || input.summary || input.codebase))
    throw new Error('Checked answers require standalone original-source context')
  const contextTokens =
    Number.isFinite(input.contextTokens) && input.contextTokens > 0
      ? Math.floor(input.contextTokens)
      : DEFAULT_CONTEXT_TOKENS
  // Preserve the normal answer allowance, with a separate bounded comparison
  // and JSON framing reserve. The same total is passed to native generation.
  const maxTokens = answerMaxTokens(contextTokens) + (checked ? 128 : 0)
  // Match the native guard's reserve as well as the minimum wrapper allowance.
  // A fixed small margin can admit a packed prompt the native check must reject.
  const contextMargin = Math.max(CONTEXT_PACK_MARGIN_TOKENS, Math.ceil(contextTokens / 10))
  const inputLimit = contextTokens - maxTokens - contextMargin
  const systemPrompt = checked
    ? buildCheckedSystemPrompt(input.language)
    : buildSystemPrompt(input.language, 'thorough', {
        codebase: input.codebase ?? false,
      })
  const systemTokens = estimateTokens(systemPrompt)
  const renderPrompt = (
    hits: RetrievalHit[],
    history: HistoryMessage[] = [],
    pinnedHits: RetrievalHit[] = [],
    contextPreamble?: string,
  ): string =>
    checked
      ? buildCheckedPrompt(input.question, hits, input.language, pinnedHits)
      : buildPrompt(input.question, hits, history, input.language, pinnedHits, contextPreamble)
  const fixedTokens = systemTokens + estimateTokens(renderPrompt([]))
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
  const baseTokens = systemTokens + estimateTokens(renderPrompt([], history, [], preamble(true)))
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
  // Catalog admission and labels can change when packing drops a passage. Keep
  // each candidate's prompt, system instruction and immutable parser together;
  // the final verified bundle is the one handed to inference, without rebuilding.
  const renderCandidate = () => {
    if (checked) {
      const bundle = buildCheckedContextBundle(input.question, hits, input.language, pinnedHits)
      return {
        checkedBundle: bundle,
        promptTokens: estimateTokens(bundle.systemPrompt) + estimateTokens(bundle.prompt),
      }
    }
    return {
      checkedBundle: undefined,
      promptTokens:
        systemTokens +
        estimateTokens(
          renderPrompt(hits, history, pinnedHits, preamble(hits.length + pinnedHits.length > 0)),
        ),
    }
  }
  let rendered = renderCandidate()
  // Verify the complete rendered prompt after selection, not only chunk sums.
  // Expansion hits are last, so they are the first removed if framing differs.
  while (rendered.promptTokens > inputLimit && (hits.length || pinnedHits.length)) {
    if (hits.length) hits = hits.slice(0, -1)
    else pinnedHits = pinnedHits.slice(0, -1)
    rendered = renderCandidate()
  }
  const promptTokens = rendered.promptTokens
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
    ...(rendered.checkedBundle ?? {}),
  }
}
