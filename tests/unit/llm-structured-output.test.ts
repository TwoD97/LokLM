import { describe, expect, it, vi } from 'vitest'
import { LlamaService } from '@main/services/llm/LlamaService'
import { BundledLlmProvider } from '@main/services/providers/bundled/BundledLlmProvider'
import type { ModelStatus } from '@shared/documents'

function fixture(raw: string) {
  let status!: (patch: Partial<ModelStatus>) => void
  const generate = vi.fn().mockResolvedValue({ raw })
  const abort = vi.fn().mockResolvedValue(undefined)
  const service = new LlamaService({
    client: {
      setStatusListener: (_kind: string, listener: typeof status) => {
        status = listener
      },
      llmGenerateRaw: generate,
      llmAbort: abort,
    } as never,
  })
  status({ state: 'ready', resident: true })
  return { service, generate, abort }
}

describe('structured native response text', () => {
  it.each([64, 128, 192] as const)(
    'forwards reasoning cap %s without adding it to the total token budget',
    async (cap) => {
      const { service, generate } = fixture('{"value":90}')
      const provider = new BundledLlmProvider(service)
      await provider.generateRaw('Answer from sources', {
        maxTokens: 2176,
        jsonSchema: { type: 'object' },
        noThink: true,
        maxBoundedThoughtTokens: cap,
      })
      expect(generate.mock.calls[0]![0]).toMatchObject({
        maxTokens: 2176,
        maxBoundedThoughtTokens: cap,
        noThink: true,
      })
      await provider.generateRaw('Translate', {})
      expect(generate.mock.calls[1]![0]).not.toHaveProperty('maxBoundedThoughtTokens')
    },
  )

  it.each([0, 63, 65, 127, 129, 191, 193, 256, 128.5, 192.5, NaN, null, '128', '192'])(
    'rejects unsupported runtime reasoning cap %s before native work',
    async (cap) => {
      const { service, generate } = fixture('{}')
      await expect(
        service.generateRaw('Answer', { maxBoundedThoughtTokens: cap as 64 | 128 | 192 }),
      ).rejects.toThrow('Unsupported bounded reasoning limit')
      expect(generate).not.toHaveBeenCalled()
    },
  )

  it('forwards an explicit per-call repetition opt-out through the bundled service only', async () => {
    const { service, generate } = fixture('{"value":90}')
    const provider = new BundledLlmProvider(service)
    await provider.generateRaw('Copy the value', { repeatPenalty: false })
    expect(generate.mock.calls[0]![0]).toMatchObject({ repeatPenalty: false })
    await provider.generateRaw('Ordinary utility', {})
    expect(generate.mock.calls[1]![0]).not.toHaveProperty('repeatPenalty')
  })

  it.each([
    'The literal tag is <think>draft</think>; the value is not final.',
    'An opening <think> tag is part of this source.',
  ])('preserves quoted source characters in JSON: %s', async (quote) => {
    const raw = JSON.stringify({ quote })
    const { service, generate } = fixture(raw)
    const jsonSchema = { type: 'object', properties: { quote: { type: 'string' } } }
    const result = await service.generateRaw('Extract a quote', { jsonSchema, noThink: true })
    expect(result).toBe(raw)
    expect(JSON.parse(result)).toEqual({ quote })
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ jsonSchema, noThink: true }))
  })

  it('keeps the plain-text reasoning filter for non-structured utility responses', async () => {
    const { service } = fixture('<think>internal</think> translated text')
    expect(await service.generateRaw('Translate')).toBe('translated text')
  })

  it.each([64, 128, 192] as const)(
    'does not return structured data after cancellation with cap %s',
    async (cap) => {
      const { service, generate, abort } = fixture('{"quote":"value"}')
      let finish!: (result: { raw: string }) => void
      generate.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      )
      const controller = new AbortController()
      const result = service.generateRaw('Extract', {
        jsonSchema: { type: 'object' },
        maxBoundedThoughtTokens: cap,
        abortSignal: controller.signal,
      })
      const rejected = expect(result).rejects.toThrow()
      controller.abort()
      finish({ raw: '{"quote":"value"}' })
      await rejected
      expect(abort).toHaveBeenCalledWith(generate.mock.calls[0]![0].streamId)
    },
  )
})
