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

/** Check utility routing against its next reset history without touching either
 * live session. The final prepared-session guard still verifies the selection. */
export function fitsFreshPromptContext(options: {
  session: PreparedSession
  initialSystemPrompt: string
  systemPrompt: string
  prompt: string
  maxTokens: number
  actualContextTokens: number
}): boolean {
  try {
    const wrapper = options.session.chatWrapper
    const initial =
      wrapper.settings.supportsSystemMessages === false
        ? []
        : wrapper.generateInitialChatHistory({ systemPrompt: options.initialSystemPrompt })
    const history = options.systemPrompt
      ? initial.map((entry, index) =>
          index === 0 || entry.type === 'system'
            ? { ...entry, type: 'system' as const, text: options.systemPrompt }
            : entry,
        )
      : initial
    const promptTokens = countPreparedPromptTokens(
      {
        getChatHistory: () => history,
        chatWrapper: wrapper,
        model: options.session.model,
      },
      options.prompt,
    )
    assertPlannedContextFits(options.actualContextTokens, options.actualContextTokens, {
      promptTokens,
      maxTokens: options.maxTokens,
    })
    return true
  } catch {
    // Never gamble on the smaller utility context when its wrapper is unknown.
    return false
  }
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
  if (options.plannedContextTokens != null) {
    try {
      exactBudget = {
        promptTokens: countPreparedPromptTokens(options.session, options.prompt),
        maxTokens: options.maxTokens,
      }
    } catch {
      // A bounded request must fail closed if the actual prepared wrapper cannot
      // be measured, including when the context size itself has not changed.
    }
  }
  options.signal?.throwIfAborted()
  assertPlannedContextFits(options.plannedContextTokens, options.actualContextTokens, exactBudget)
}
