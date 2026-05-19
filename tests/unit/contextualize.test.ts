import { describe, it, expect, vi } from 'vitest'
import { contextualizeQuery } from '@main/services/qa/QAService'

const llm = (raw: string, opts: { ready?: boolean } = {}) => ({
  isReady: () => opts.ready ?? true,
  generateRaw: vi.fn().mockResolvedValue(raw),
})

describe('contextualizeQuery', () => {
  it('returns the raw query when history is empty', async () => {
    const fake = llm('rewrite')
    const out = await contextualizeQuery(fake, [], 'tell me more')
    expect(out).toBe('tell me more')
    expect(fake.generateRaw).not.toHaveBeenCalled()
  })

  it('returns the raw query when the LLM is not ready', async () => {
    const fake = llm('rewrite', { ready: false })
    const out = await contextualizeQuery(
      fake,
      [{ role: 'user', content: 'first question' }],
      'and?',
    )
    expect(out).toBe('and?')
    expect(fake.generateRaw).not.toHaveBeenCalled()
  })

  it('rewrites a follow-up using prior turns', async () => {
    const fake = llm('more details about setting up a Windows VM in Proxmox')
    const out = await contextualizeQuery(
      fake,
      [
        { role: 'user', content: 'wie setze ich eine windows vm auf?' },
        { role: 'assistant', content: 'Schritte: 1. VM erstellen 2. ...' },
      ],
      'gibt noch was dazu?',
    )
    expect(out).toBe('more details about setting up a Windows VM in Proxmox')
    const sent = fake.generateRaw.mock.calls[0]![0] as string
    expect(sent).toContain('User: wie setze ich eine windows vm auf?')
    expect(sent).toContain('Assistant: Schritte: 1. VM erstellen 2. ...')
    expect(sent).toContain('Follow-up question: gibt noch was dazu?')
  })

  it('strips surrounding quotes and "Query:" preambles', async () => {
    const fake = llm('"Query: Windows VM Proxmox Setup"')
    const out = await contextualizeQuery(
      fake,
      [{ role: 'user', content: 'previous' }],
      'tell me more',
    )
    expect(out).toBe('Windows VM Proxmox Setup')
  })

  it('keeps the first non-empty line when the model rambles a bit', async () => {
    const fake = llm('\n\nWindows VM Proxmox setup steps\n\nExplanation: blah')
    const out = await contextualizeQuery(fake, [{ role: 'user', content: 'previous' }], 'and?')
    expect(out).toBe('Windows VM Proxmox setup steps')
  })

  it('falls back to the raw query on LLM errors', async () => {
    const fake = {
      isReady: () => true,
      generateRaw: vi.fn().mockRejectedValue(new Error('boom')),
    }
    const out = await contextualizeQuery(fake, [{ role: 'user', content: 'previous' }], 'and?')
    expect(out).toBe('and?')
  })

  it('falls back to the raw query when the rewrite is empty', async () => {
    const fake = llm('   \n   ')
    const out = await contextualizeQuery(fake, [{ role: 'user', content: 'previous' }], 'and?')
    expect(out).toBe('and?')
  })

  it('falls back to the raw query when the rewrite is suspiciously long', async () => {
    const fake = llm('x'.repeat(500))
    const out = await contextualizeQuery(fake, [{ role: 'user', content: 'previous' }], 'and?')
    expect(out).toBe('and?')
  })

  it('truncates long history turns before sending to the LLM', async () => {
    const fake = llm('rewrite')
    const longContent = 'a'.repeat(2000)
    await contextualizeQuery(fake, [{ role: 'assistant', content: longContent }], 'and?')
    const sent = fake.generateRaw.mock.calls[0]![0] as string
    // 600-char cap plus the ellipsis marker — must not contain the full 2000.
    expect(sent).not.toContain('a'.repeat(2000))
    expect(sent).toContain('a'.repeat(600))
    expect(sent).toContain('…')
  })

  it('only sends the last 6 turns of history', async () => {
    const fake = llm('rewrite')
    const history = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `turn-${i}`,
    }))
    await contextualizeQuery(fake, history, 'and?')
    const sent = fake.generateRaw.mock.calls[0]![0] as string
    expect(sent).not.toContain('turn-0')
    expect(sent).not.toContain('turn-3')
    expect(sent).toContain('turn-4')
    expect(sent).toContain('turn-9')
  })
})
