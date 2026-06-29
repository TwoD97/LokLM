import { describe, it, expect } from 'vitest'
import { LLM_PROFILES, pickProfileGguf, answerDepthFor } from '@main/services/llm/LlamaService'

const lite = () => LLM_PROFILES.find((p) => p.name === 'lite')!
const FILE_4B = 'Qwen3.5-4B-Q4_K_M.gguf'
const FILE_2B = 'Qwen3.5-2B-Q4_K_M.gguf'

describe('lite profile — 4B preferred, 2B fallback (0.6.3)', () => {
  it('lite targets 12 GB and stays at 8K context', () => {
    expect(lite().minTotalMemGB).toBe(12)
    expect(lite().contextSize).toBe(8192)
  })

  it('pickProfileGguf prefers the 4B when both are on disk', () => {
    // 2B listed FIRST in the dir — preference must come from pattern order, not
    // directory order.
    expect(pickProfileGguf(lite().filenamePatterns, [FILE_2B, FILE_4B])).toBe(FILE_4B)
    expect(pickProfileGguf(lite().filenamePatterns, [FILE_4B, FILE_2B])).toBe(FILE_4B)
  })

  it('falls back to the 2B when only the 2B is present', () => {
    expect(pickProfileGguf(lite().filenamePatterns, [FILE_2B])).toBe(FILE_2B)
  })

  it('returns null when neither tier model is present', () => {
    expect(pickProfileGguf(lite().filenamePatterns, ['bge-m3-Q4_K_M.gguf'])).toBeNull()
    expect(pickProfileGguf(lite().filenamePatterns, [])).toBeNull()
  })
})

describe('answerDepthFor — model-aware lite depth', () => {
  it('lite + 4B answers at standard depth', () => {
    expect(answerDepthFor('lite', `/models/${FILE_4B}`)).toBe('standard')
  })

  it('lite + 2B fallback stays concise (the 2B think-loops at standard)', () => {
    expect(answerDepthFor('lite', `/models/${FILE_2B}`)).toBe('concise')
  })

  it('full and xl are unaffected', () => {
    expect(answerDepthFor('full', `/models/${FILE_4B}`)).toBe('standard')
    expect(answerDepthFor('xl', '/models/Qwen3.5-9B-Q4_K_M.gguf')).toBe('thorough')
  })

  it('defaults to concise before any model is pinned', () => {
    expect(answerDepthFor(null, null)).toBe('concise')
    // profile known but file not yet pinned → profile default (not the 2B demotion)
    expect(answerDepthFor('lite', null)).toBe('standard')
  })
})
