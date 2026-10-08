import { setImmediate as eventLoopTurn } from 'node:timers/promises'
import type {
  ChatWrapper,
  LlamaContext,
  LlamaContextSequence,
  LlamaGrammarEvaluationState,
  LlamaModel,
  LlamaText,
  QwenChatWrapper,
  Token,
} from 'node-llama-cpp'

type Sdk = { QwenChatWrapper: typeof QwenChatWrapper; LlamaText: typeof LlamaText }
type Context = Pick<LlamaContext, 'contextSize' | 'batchSize'>
type Sequence = Pick<
  LlamaContextSequence,
  | 'model'
  | 'context'
  | 'tokenPredictor'
  | 'evaluate'
  | 'evaluateWithoutGeneratingNewTokens'
  | 'clearHistory'
>

/** A maximum for the explicit adapter, never a requirement to use the selected limit. */
export function supportsBoundedThoughts(
  wrapper: ChatWrapper,
  sdk: Pick<Sdk, 'QwenChatWrapper'>,
): boolean {
  return wrapper instanceof sdk.QwenChatWrapper && wrapper.variation === '3.5'
}

export class UnsafeNativeStateError extends Error {
  readonly requiresWorkerRetirement = true
  constructor() {
    super('Native sequence cleanup failed; the model worker must restart.')
    this.name = 'UnsafeNativeStateError'
  }
}

/** Private, per-request plan. Never serialize prompt tokens or model handles. */
export function planBoundedThoughts(input: {
  model: LlamaModel
  context: Context
  detectedWrapper: ChatWrapper
  sdk: Sdk
  prompt: string
  systemPrompt: string
  maxTokens: number
  maxThoughtTokens?: 64 | 128 | 192
}) {
  const { model, context, sdk, maxTokens } = input
  const maxThoughtTokens = input.maxThoughtTokens === undefined ? 64 : input.maxThoughtTokens
  if (maxThoughtTokens !== 64 && maxThoughtTokens !== 128 && maxThoughtTokens !== 192)
    throw new Error('Unsupported bounded thought allowance.')
  if (!supportsBoundedThoughts(input.detectedWrapper, sdk))
    throw new Error('The bounded thought adapter is unavailable.')
  if (
    !Number.isSafeInteger(context.contextSize) ||
    context.contextSize < 1 ||
    !Number.isSafeInteger(context.batchSize) ||
    context.batchSize < 1 ||
    !Number.isSafeInteger(maxTokens) ||
    maxTokens < 1
  )
    throw new Error('The bounded thought context could not be verified.')
  const detected = input.detectedWrapper as QwenChatWrapper
  const wrapper = new sdk.QwenChatWrapper({
    variation: '3.5',
    thoughts: 'auto',
    keepOnlyLastThought: detected.keepOnlyLastThought,
  })
  const close = model.tokenize('</think>', true)
  const suffixText = wrapper.settings.segments?.thought?.suffix
  if (suffixText == null)
    throw new Error('The identified Qwen thought boundary could not be verified.')
  const suffix = sdk.LlamaText(suffixText).tokenize(model.tokenizer)
  if (
    wrapper.settings.segments?.thought?.openOnResponseStart !== true ||
    close.length !== 1 ||
    !(model.isSpecialToken(close[0]!) || model.getTokenAttributes(close[0]!).userDefined) ||
    model.detokenize(close, true) !== '</think>' ||
    !suffix.length ||
    suffix.at(-1) !== close[0] ||
    suffix.some((token) => !Number.isSafeInteger(token) || token < 0)
  )
    throw new Error('The identified Qwen thought boundary could not be verified.')
  if (maxTokens <= maxThoughtTokens + suffix.length)
    throw new Error('The output allowance cannot fit bounded thoughts and a final response.')
  const promptTokens = wrapper
    .generateContextState({
      chatHistory: [
        { type: 'system', text: input.systemPrompt },
        { type: 'user', text: input.prompt },
        {
          type: 'model',
          response: [{ type: 'segment', segmentType: 'thought', text: '', ended: false }],
        },
      ],
    })
    .contextText.tokenize(model.tokenizer)
  const margin = Math.max(64, Math.ceil(context.contextSize / 10))
  if (
    !promptTokens.length ||
    promptTokens.some((token) => !Number.isSafeInteger(token) || token < 0) ||
    promptTokens.length + maxTokens + margin > context.contextSize
  )
    throw new Error(
      'The selected sources and bounded output allowance do not fit the model context.',
    )
  return Object.freeze({
    model,
    context,
    contextSize: context.contextSize,
    batchSize: context.batchSize,
    promptTokens: Object.freeze(promptTokens.slice()),
    thoughtCloseToken: close[0]!,
    forcedCloseTokens: Object.freeze(suffix.slice()),
    maxTokens,
    maxThoughtTokens,
  })
}
export type BoundedThoughtPlan = ReturnType<typeof planBoundedThoughts>
export type BoundedThoughtTelemetry = {
  promptTokens: number
  prefillBatches: number
  prefillTokens: number
  thoughtTokens: number
  thoughtClosingTokens: number
  forcedClosingTokens: number
  /** Constrained envelope tokens (including its private check), not UI answer tokens. */
  visibleTokens: number
  combinedTokens: number
  /** Constrained-envelope timestamps, not UI answer latency. Both include
   * initial clear and every prefill batch. No envelope text is retained here. */
  firstVisibleMs: number | null
  lastVisibleMs: number | null
  thoughtTermination: 'natural' | 'budget' | null
}
export const boundedThoughtTelemetry = (): BoundedThoughtTelemetry => ({
  promptTokens: 0,
  prefillBatches: 0,
  prefillTokens: 0,
  thoughtTokens: 0,
  thoughtClosingTokens: 0,
  forcedClosingTokens: 0,
  visibleTokens: 0,
  combinedTokens: 0,
  firstVisibleMs: null,
  lastVisibleMs: null,
  thoughtTermination: null,
})

/** Caller retains the native FIFO until this promise AND cleanup settle.
 * onUnsafeState synchronously closes worker admission; it must not await an
 * unload queued behind this same operation. Retire the owned process afterward.
 */
export async function generateWithBoundedThoughts(input: {
  sequence: Sequence
  plan: BoundedThoughtPlan
  signal: AbortSignal
  telemetry: BoundedThoughtTelemetry
  createGrammarState: () => LlamaGrammarEvaluationState
  onUnsafeState: () => void
  yieldEventLoop?: () => Promise<void>
}): Promise<{
  responseText: string
  stopReason: 'eogToken' | 'stopGenerationTrigger' | 'maxTokens'
}> {
  const { sequence, plan, signal, telemetry } = input
  if (
    sequence.model !== plan.model ||
    sequence.context !== plan.context ||
    sequence.context.contextSize !== plan.contextSize ||
    sequence.context.batchSize !== plan.batchSize ||
    sequence.tokenPredictor
  )
    throw new Error('The captured bounded thought context changed.')
  const startedAt = Date.now()
  telemetry.promptTokens = plan.promptTokens.length
  const abort = () => signal.throwIfAborted()
  const contextShift = {
    strategy: (): never => {
      throw new Error('Context shifting is disabled for bounded answers.')
    },
  }
  const base = { temperature: 0, yieldEogToken: true, contextShift }
  let touched = false
  let unsafe = false
  let iterator: AsyncGenerator<Token, void, void | Token | Token[]> | undefined
  let bridge: Token[] = []
  const visible: Token[] = []
  const markUnsafe = (): never => {
    unsafe = true
    try {
      input.onUnsafeState()
    } catch {
      /* retirement error still reaches owner */
    }
    throw new UnsafeNativeStateError()
  }
  const clear = async () => {
    try {
      await sequence.clearHistory()
    } catch {
      markUnsafe()
    }
  }
  const drain = async () => {
    const current = iterator
    iterator = undefined
    if (!current) return
    try {
      await current.return()
    } catch {
      // Ownership is uncertain: neither clear the context nor admit another
      // native operation after a failed iterator drain.
      markUnsafe()
    }
  }
  try {
    abort()
    touched = true
    await clear()
    abort()
    const prefixLength = plan.promptTokens.length - 1
    for (let offset = 0; offset < prefixLength; offset += plan.batchSize) {
      abort()
      const tokens = plan.promptTokens.slice(
        offset,
        Math.min(prefixLength, offset + plan.batchSize),
      )
      await sequence.evaluateWithoutGeneratingNewTokens(tokens, { contextShift })
      telemetry.prefillBatches++
      telemetry.prefillTokens += tokens.length
      abort()
      await (input.yieldEventLoop ?? eventLoopTurn)()
      abort()
    }
    // Public evaluate yields a token before committing it. On phase change,
    // commit the final yielded token exactly once with the next iterator.
    iterator = sequence.evaluate([plan.promptTokens.at(-1)!], base)
    try {
      while (true) {
        abort()
        const item = await iterator.next()
        abort()
        if (item.done || !Number.isSafeInteger(item.value))
          throw new Error('Thought ended without a verified boundary.')
        const token = item.value
        telemetry.combinedTokens++
        if (plan.model.isEogToken(token))
          throw new Error('Thought ended before the final response.')
        if (token === plan.thoughtCloseToken) {
          telemetry.thoughtClosingTokens++
          telemetry.thoughtTermination = 'natural'
          bridge = [token]
          break
        }
        telemetry.thoughtTokens++
        if (telemetry.thoughtTokens === plan.maxThoughtTokens) {
          telemetry.thoughtTermination = 'budget'
          telemetry.forcedClosingTokens = plan.forcedCloseTokens.length
          telemetry.combinedTokens += plan.forcedCloseTokens.length
          bridge = [token, ...plan.forcedCloseTokens]
          break
        }
      }
    } finally {
      await drain()
    }
    abort()
    const grammarEvaluationState = input.createGrammarState()
    if (!grammarEvaluationState) throw new Error('Structured output grammar is unavailable.')
    iterator = sequence.evaluate(bridge, { ...base, grammarEvaluationState })
    let responseText = ''
    while (telemetry.combinedTokens < plan.maxTokens) {
      abort()
      const item = await iterator.next()
      abort()
      if (item.done || !Number.isSafeInteger(item.value))
        throw new Error('Final response ended without a verified termination.')
      telemetry.combinedTokens++
      if (plan.model.isEogToken(item.value)) return { responseText, stopReason: 'eogToken' }
      visible.push(item.value)
      telemetry.visibleTokens++
      responseText = plan.model.detokenize(visible, false)
      if (responseText.length) {
        telemetry.firstVisibleMs ??= Date.now() - startedAt
        telemetry.lastVisibleMs = Date.now() - startedAt
      }
      abort()
      const stopIndex = responseText.indexOf('\n\n\n\n')
      if (stopIndex >= 0)
        return {
          responseText: responseText.slice(0, stopIndex),
          stopReason: 'stopGenerationTrigger',
        }
    }
    abort()
    return { responseText, stopReason: 'maxTokens' }
  } finally {
    try {
      await drain()
    } finally {
      visible.fill(0 as Token)
      bridge.fill(0 as Token)
      if (touched && !unsafe) await clear()
    }
  }
}
