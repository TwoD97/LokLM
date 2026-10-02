import { describe, expect, it, vi } from 'vitest'
import { LlamaService } from '@main/services/llm/LlamaService'
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

  it('does not return structured data after cancellation during native generation', async () => {
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
      abortSignal: controller.signal,
    })
    const rejected = expect(result).rejects.toThrow()
    controller.abort()
    finish({ raw: '{"quote":"value"}' })
    await rejected
    expect(abort).toHaveBeenCalledWith(generate.mock.calls[0]![0].streamId)
  })
})
