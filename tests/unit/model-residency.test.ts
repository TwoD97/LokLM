import { describe, expect, it, vi } from 'vitest'
import { ModelResidency } from '@main/services/workers/ModelResidency'
import type { ModelTask, ModelTransition } from '@shared/modelActivity'

function fixture(total = 4, free = 1) {
  const loaded = new Set<ModelTask>(['llm'])
  const events: string[] = []
  const states: ModelTransition[] = []
  const manager = new ModelResidency({
    loaded: (task) => loaded.has(task),
    unload: async (task) => {
      events.push(`unload ${task}`)
      loaded.delete(task)
    },
    resources: async () => ({ hasGpu: total > 0, totalVramGB: total, freeVramGB: free }),
    activity: (state) => states.push(state),
  })
  return { manager, loaded, events, states }
}

describe('task-based GPU residency', () => {
  it('unloads chat before loading embeddings and releases embeddings to restore chat', async () => {
    const { manager, loaded, events, states } = fixture()
    await manager.load('embedder', 600e6, async () => {
      events.push('load embedder')
      loaded.add('embedder')
    })
    await manager.load('llm', 2.7e9, async () => {
      events.push('load llm')
      loaded.add('llm')
    })
    expect(events).toEqual(['unload llm', 'load embedder', 'unload embedder', 'load llm'])
    expect(states.at(-1)?.phase).toBe('idle')
  })
  it('keeps other models resident when a roomy GPU can fit them', async () => {
    const { manager, events } = fixture(24, 15)
    await manager.load('embedder', 600e6, async () => {})
    expect(events).toEqual([])
  })
  it('retries GPU allocation after evicting idle models if the memory estimate was optimistic', async () => {
    const { manager, events } = fixture(24, 15)
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('Not enough VRAM'))
      .mockResolvedValue('gpu')
    expect(await manager.load('embedder', 600e6, load)).toBe('gpu')
    expect(events).toEqual(['unload llm'])
    expect(load).toHaveBeenCalledTimes(2)
  })
  it('reports allocation errors without invoking a CPU fallback', async () => {
    const { manager, states } = fixture()
    const load = vi.fn().mockRejectedValue(new Error('Not enough VRAM'))
    await expect(manager.load('embedder', 600e6, load)).rejects.toThrow('Not enough VRAM')
    expect(load).toHaveBeenCalledOnce()
    expect(states.at(-1)?.phase).toBe('error')
  })
  it('requires a GPU before loading any model', async () => {
    const { manager } = fixture(0, 0)
    const load = vi.fn()
    await expect(manager.load('embedder', 600e6, load)).rejects.toThrow('GPU is required')
    expect(load).not.toHaveBeenCalled()
  })
})
