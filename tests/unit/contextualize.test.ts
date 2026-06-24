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

  it('rewrites a follow-up using prior USER turns (assistant answers excluded)', async () => {
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
    // Assistant answers are NOT fed to the rewrite — a wrong answer must not
    // poison the next query (the "each turn makes it worse" failure).
    expect(sent).not.toContain('Schritte: 1. VM erstellen')
    expect(sent).toContain('Follow-up question: gibt noch was dazu?')
  })

  it('anchors a pure meta follow-up on the last user question, no LLM', async () => {
    const fake = llm('SHOULD NOT BE CALLED')
    const out = await contextualizeQuery(
      fake,
      [
        { role: 'user', content: 'was macht die auth klasse' },
        { role: 'assistant', content: 'Die AuthService-Klasse verwaltet den Tresor …' },
      ],
      'genauer?',
    )
    expect(out).toBe('was macht die auth klasse')
    expect(fake.generateRaw).not.toHaveBeenCalled()
  })

  it('a wrong prior assistant answer cannot poison the next rewrite', async () => {
    const fake = llm('was macht die auth klasse')
    await contextualizeQuery(
      fake,
      [
        { role: 'user', content: 'was macht die auth klasse' },
        {
          role: 'assistant',
          content: 'Genauigkeit von Übersetzungsmodellen chrF translation geology',
        },
      ],
      'what does the auth class do exactly?',
    )
    const sent = fake.generateRaw.mock.calls[0]![0] as string
    expect(sent).not.toContain('Genauigkeit')
    expect(sent).not.toContain('translation')
    expect(sent).toContain('User: was macht die auth klasse')
  })

  it('strips surrounding quotes and "Query:" preambles', async () => {
    const fake = llm('"Query: Windows VM Proxmox Setup"')
    const out = await contextualizeQuery(
      fake,
      [{ role: 'user', content: 'previous' }],
      'what about the network setup?',
    )
    expect(out).toBe('Windows VM Proxmox Setup')
  })

  it('keeps the first non-empty line when the model rambles a bit', async () => {
    const fake = llm('\n\nWindows VM Proxmox setup steps\n\nExplanation: blah')
    const out = await contextualizeQuery(
      fake,
      [{ role: 'user', content: 'previous' }],
      'what about the network setup?',
    )
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
    await contextualizeQuery(fake, [{ role: 'user', content: longContent }], 'what about it now?')
    const sent = fake.generateRaw.mock.calls[0]![0] as string
    // 600-char cap plus the ellipsis marker — must not contain the full 2000.
    expect(sent).not.toContain('a'.repeat(2000))
    expect(sent).toContain('a'.repeat(600))
    expect(sent).toContain('…')
  })

  it('only sends the last 6 USER turns (assistant turns excluded)', async () => {
    const fake = llm('rewrite')
    // 14 turns alternating → 7 user turns (T0,T2,…,T12); the 6-cap drops T0.
    const history = Array.from({ length: 14 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `T${i}.`,
    }))
    await contextualizeQuery(fake, history, 'what about it now?')
    const sent = fake.generateRaw.mock.calls[0]![0] as string
    expect(sent).not.toContain('T0.') // oldest user turn dropped by the cap
    expect(sent).toContain('T2.')
    expect(sent).toContain('T12.')
    expect(sent).not.toContain('T1.') // assistant turn never sent
    expect(sent).not.toContain('T13.') // assistant turn never sent
  })
})
