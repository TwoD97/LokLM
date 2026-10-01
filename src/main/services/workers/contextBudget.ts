import type { LlamaChatSession } from 'node-llama-cpp'
import { answerMaxTokens } from '../llm/prompt'
import { assertPlannedContextFits } from './modelMemory'

type PreparedSession = Pick<LlamaChatSession, 'getChatHistory' | 'chatWrapper' | 'model'>

/** Use only public node-llama-cpp APIs and the already reset/patched session.
 * Mirrors promptWithMeta's user + empty model append, without modifying history.
 * No tokens or source text leave this process or enter diagnostics. */
export function countPreparedPromptTokens(session: PreparedSession, prompt: string): number {
  const history = session.getChatHistory().slice()
  const last = history.at(-1)
  if (last?.type === 'user') {
    history[history.length - 1] = { ...last, text: [last.text, prompt].join('\n\n') }
  } else history.push({ type: 'user', text: prompt })
  history.push({ type: 'model', response: [] })
  return session.chatWrapper
    .generateContextState({ chatHistory: history })
    .contextText.tokenize(session.model.tokenizer).length
}

type PreparedPromptOptions = {
  session: PreparedSession
  plannedContextTokens?: number | undefined
  actualContextTokens: number
  prompt: string
  maxTokens: number
  signal?: AbortSignal | undefined
}

/** A queued chat can regain a smaller context after its caller chose an output
 * allowance. Reapply the same quarter-window cap to the final native capacity;
 * preserve every prompt token and still reject evidence that cannot fit. Raw
 * generations retain their explicit budgets and completeness contracts. */
export function prepareChatPromptBudget(options: PreparedPromptOptions): number {
  const allowance = answerMaxTokens(options.actualContextTokens)
  const maxTokens = Math.max(
    1,
    Math.min(
      allowance,
      Number.isFinite(options.maxTokens) ? Math.floor(options.maxTokens) : allowance,
    ),
  )
  assertPreparedPromptFits({ ...options, maxTokens })
  return maxTokens
}

export function assertPreparedPromptFits(options: PreparedPromptOptions): void {
  options.signal?.throwIfAborted()
  let exactBudget: { promptTokens: number; maxTokens: number } | undefined
  if (
    options.plannedContextTokens != null &&
    options.actualContextTokens < options.plannedContextTokens
  ) {
    try {
      exactBudget = {
        promptTokens: countPreparedPromptTokens(options.session, options.prompt),
        maxTokens: options.maxTokens,
      }
    } catch {
      // If a wrapper cannot be measured, retain the safe changed-capacity error.
    }
  }
  options.signal?.throwIfAborted()
  assertPlannedContextFits(options.plannedContextTokens, options.actualContextTokens, exactBudget)
}
