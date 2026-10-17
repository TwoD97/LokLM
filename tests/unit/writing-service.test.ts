import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WritingService } from '@main/services/writing/WritingService'
import { OllamaLlmProvider } from '@main/services/providers/ollama/OllamaLlmProvider'
import { detectResponseLanguage } from '@main/services/documents/languageDetector'

vi.mock('@main/services/documents/languageDetector', () => ({
  detectResponseLanguage: vi.fn(async () => 'en'),
}))

beforeEach(() => vi.clearAllMocks())

function fixture(doneReason: 'length' | 'stop') {
  const client = {
    postNdjson: vi.fn(async function* () {
      yield { response: 'Rewritten text: A clearer sentence.' }
      yield { done: true, done_reason: doneReason }
    }),
  }
  const provider = new OllamaLlmProvider(client as never, 'qwen3:8b')
  const service = new WritingService({ llm: () => provider } as never)
  return { client, service }
}

describe('writing completion and cancellation', () => {
  it('rejects an output-limit cutoff instead of publishing a partial rewrite as complete', async () => {
    const { service } = fixture('length')
    await expect(service.improve('An unclear sentence.', 'improve')).rejects.toThrow(
      /output limit/i,
    )
  })

  it('returns a normally completed rewrite with the existing label cleanup', async () => {
    const { service } = fixture('stop')
    await expect(service.improve('An unclear sentence.', 'improve')).resolves.toEqual({
      text: 'A clearer sentence.',
      detected: 'en',
      mode: 'improve',
    })
  })

  it('does not start generation if cancellation arrives during language detection', async () => {
    let finish!: (language: 'en') => void
    vi.mocked(detectResponseLanguage).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const { service, client } = fixture('stop')
    const controller = new AbortController()
    const running = service.improve('An unclear sentence.', 'improve', {
      abortSignal: controller.signal,
    })
    controller.abort()
    finish('en')
    await expect(running).rejects.toMatchObject({ name: 'AbortError' })
    expect(client.postNdjson).not.toHaveBeenCalled()
  })

  it('rejects a late result from a provider that ignores cancellation', async () => {
    const controller = new AbortController()
    const provider = {
      isReady: () => true,
      contextWindowTokens: () => 4096,
      generateRaw: async () => {
        controller.abort()
        return 'Late private rewrite.'
      },
    }
    const service = new WritingService({ llm: () => provider } as never)
    await expect(
      service.improve('An unclear sentence.', 'improve', { abortSignal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
