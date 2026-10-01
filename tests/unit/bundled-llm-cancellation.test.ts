import { describe, expect, it, vi } from 'vitest'
import { BundledLlmProvider } from '@main/services/providers/bundled/BundledLlmProvider'

describe('bundled provider cancellation', () => {
  it.each(['ask', 'generateRaw'] as const)(
    'does not load the model for an already cancelled %s',
    async (kind) => {
      const inner = { ensureLoaded: vi.fn(), ask: vi.fn(), generateRaw: vi.fn() }
      const provider = new BundledLlmProvider(inner as never)
      const options = { abortSignal: AbortSignal.abort() }
      const request =
        kind === 'ask'
          ? provider.ask('Question', [], options)
          : provider.generateRaw('Prompt', options)
      await expect(request).rejects.toThrow(/abort/i)
      expect(inner.ensureLoaded).not.toHaveBeenCalled()
      expect(inner.ask).not.toHaveBeenCalled()
      expect(inner.generateRaw).not.toHaveBeenCalled()
    },
  )

  it.each(['ask', 'generateRaw'] as const)(
    'does not dispatch %s if cancelled while loading',
    async (kind) => {
      let finish!: () => void
      const loading = new Promise<void>((resolve) => {
        finish = resolve
      })
      const inner = {
        ensureLoaded: vi.fn().mockReturnValue(loading),
        ask: vi.fn(),
        generateRaw: vi.fn(),
      }
      const provider = new BundledLlmProvider(inner as never)
      const controller = new AbortController()
      const options = { abortSignal: controller.signal }
      const request =
        kind === 'ask'
          ? provider.ask('Question', [], options)
          : provider.generateRaw('Prompt', options)
      const rejected = expect(request).rejects.toThrow(/abort/i)
      controller.abort()
      finish()
      await rejected
      expect(inner.ensureLoaded).toHaveBeenCalledOnce()
      expect(inner.ask).not.toHaveBeenCalled()
      expect(inner.generateRaw).not.toHaveBeenCalled()
    },
  )
})
