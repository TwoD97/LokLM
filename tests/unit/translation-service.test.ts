import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TranslationService,
  TRANSLATION_SYSTEM_PROMPT,
} from '../../src/main/services/translation/TranslationService'
import type { ProviderRegistry } from '../../src/main/services/providers/Registry'

vi.mock('../../src/main/services/documents/languageDetector', () => ({
  detectIsoLanguage: vi.fn(async () => 'en'),
}))

const generateRaw = vi.fn(async (prompt: string) => prompt.split('\n\n').slice(1).join('\n\n'))
const isReady = vi.fn(() => true)
const ensureReady = vi.fn(async () => {})
const hasLocalModel = vi.fn(() => true)
const contextWindowTokens = vi.fn(() => 4096)
const getLlmSource = vi.fn(() => 'bundled')
const getModelStatus = vi.fn(() => ({ state: 'ready', message: null, modelName: 'Qwen' }))
const registry = {
  llm: () => ({ generateRaw, isReady, contextWindowTokens, getModelStatus }),
  getLlmSource,
}
const service = new TranslationService(registry as unknown as ProviderRegistry, {
  ensureReady,
  hasLocalModel,
})

beforeEach(() => {
  vi.clearAllMocks()
  isReady.mockReturnValue(true)
  hasLocalModel.mockReturnValue(true)
  contextWindowTokens.mockReturnValue(4096)
  getLlmSource.mockReturnValue('bundled')
})

describe('shared LLM translation', () => {
  it('uses task instructions, deterministic sampling and no reasoning, with progress', async () => {
    const onProgress = vi.fn()
    const result = await service.translate('Hello. How are you?', { target: 'de' }, { onProgress })
    expect(result).toMatchObject({ text: 'Hello. How are you?', detected: 'en', sentences: 2 })
    expect(ensureReady).toHaveBeenCalledOnce()
    expect(generateRaw).toHaveBeenCalledWith(
      expect.stringContaining('German'),
      expect.objectContaining({
        systemPrompt: TRANSLATION_SYSTEM_PROMPT,
        temperature: 0,
        noThink: true,
      }),
    )
    expect(onProgress.mock.calls).toEqual([
      [{ completed: 0, total: 1 }],
      [{ completed: 1, total: 1 }],
    ])
  })

  it('preserves whitespace and bounds multilingual chunks to the utility context', async () => {
    const text = '  ' + 'Hello world. 日本語 😀\r\n\r\n'.repeat(150) + '\t'
    expect((await service.translate(text, { target: 'en' })).text).toBe(text)
    expect(generateRaw.mock.calls.length).toBeGreaterThan(1)
    for (const call of generateRaw.mock.calls as unknown as Array<
      [string, { maxTokens: number }]
    >) {
      const bytes = Buffer.byteLength(call[0].split('\n\n').slice(1).join('\n\n'))
      expect(bytes).toBeLessThanOrEqual(1024)
      expect(bytes + call[1].maxTokens + 768).toBeLessThanOrEqual(4096)
    }
  })

  it('validates requests without loading the model', async () => {
    await expect(service.translate('text', { target: 'invalid' })).rejects.toThrow('Unsupported')
    await expect(service.translate('x'.repeat(200001), { target: 'de' })).rejects.toThrow('200,000')
    expect(await service.translate(' \n\t', { target: 'de' })).toMatchObject({
      text: ' \n\t',
      sentences: 0,
    })
    expect(ensureReady).not.toHaveBeenCalled()
  })

  it('accepts the legacy Hebrew language code', async () => {
    await service.translate('Hello', { target: 'iw' })
    expect(generateRaw.mock.calls[0]?.[0]).toContain('Hebrew')
  })

  it('rejects cancellation before loading or before the next chunk', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      service.translate('hello', { target: 'de' }, { abortSignal: controller.signal }),
    ).rejects.toThrow()
    expect(ensureReady).not.toHaveBeenCalled()
    const mid = new AbortController()
    generateRaw.mockImplementationOnce(async () => {
      mid.abort()
      return 'partial'
    })
    await expect(
      service.translate('word '.repeat(1000), { target: 'de' }, { abortSignal: mid.signal }),
    ).rejects.toThrow()
    expect(generateRaw).toHaveBeenCalledOnce()
  })

  it('never presents empty or failed generations as a complete translation', async () => {
    generateRaw.mockResolvedValueOnce('  ')
    await expect(service.translate('hello', { target: 'de' })).rejects.toThrow('empty translation')
    generateRaw.mockRejectedValueOnce(new Error('Model failed'))
    await expect(service.translate('hello', { target: 'de' })).rejects.toThrow('Model failed')
  })

  it('reports the selected model and checks readiness and context', async () => {
    expect(service.status()).toMatchObject({ state: 'ready', modelName: 'Qwen' })
    isReady.mockReturnValue(false)
    hasLocalModel.mockReturnValue(false)
    expect(service.status().state).toBe('not_installed')
    getLlmSource.mockReturnValue('ollama')
    expect(service.status().state).toBe('installed')
    await expect(service.translate('hello', { target: 'de' })).rejects.toThrow(
      'could not be loaded',
    )
    isReady.mockReturnValue(true)
    contextWindowTokens.mockReturnValue(1024)
    await expect(service.translate('hello', { target: 'de' })).rejects.toThrow('1,536')
  })
})
