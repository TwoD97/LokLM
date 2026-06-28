import { describe, it, expect, vi } from 'vitest'
import { contextualizeQuery, heuristicContextualizeQuery } from '@main/services/qa/QAService'

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

describe('heuristicContextualizeQuery (lite / no-LLM path)', () => {
  const hist = (...qs: string[]): Array<{ role: 'user' | 'assistant'; content: string }> =>
    qs.map((content) => ({ role: 'user' as const, content }))

  it('returns the query unchanged when history is empty', () => {
    expect(heuristicContextualizeQuery([], 'was ist ein interpreter?')).toBe(
      'was ist ein interpreter?',
    )
  })

  it('anchors a pure meta follow-up on the prior USER question', () => {
    expect(heuristicContextualizeQuery(hist('was ist ein interpreter?'), 'genauer?')).toBe(
      'was ist ein interpreter?',
    )
    expect(heuristicContextualizeQuery(hist('what is an interpreter?'), 'more')).toBe(
      'what is an interpreter?',
    )
  })

  it('prepends the prior question for a short anaphoric follow-up', () => {
    expect(
      heuristicContextualizeQuery(hist('was ist ein interpreter?'), 'und bei JavaScript?'),
    ).toBe('was ist ein interpreter? und bei JavaScript?')
    expect(heuristicContextualizeQuery(hist('what is an interpreter?'), 'why is that?')).toBe(
      'what is an interpreter? why is that?',
    )
  })

  it('treats a long / standalone new question as standalone', () => {
    const q = 'was ist der unterschied zwischen einem compiler und einem assembler genau?'
    expect(heuristicContextualizeQuery(hist('was ist ein interpreter?'), q)).toBe(q)
  })

  it('ignores assistant turns when picking the anchor', () => {
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: 'was ist ein interpreter?' },
      { role: 'assistant', content: 'Ein Interpreter führt Code direkt aus.' },
    ]
    expect(heuristicContextualizeQuery(history, 'genauer?')).toBe('was ist ein interpreter?')
  })

  // --- comparison / reflexive follow-ups (the reported "unchanged" bug) ---
  it('prepends for a German reflexive comparison follow-up ("unterscheidet sich vom X")', () => {
    expect(
      heuristicContextualizeQuery(
        hist('Was ist ein interpreter?'),
        'Wie unterscheidet sich vom Compiler?',
      ),
    ).toBe('Was ist ein interpreter? Wie unterscheidet sich vom Compiler?')
  })

  it('prepends for a bare comparison fragment ("Unterschied zum X?")', () => {
    expect(
      heuristicContextualizeQuery(hist('was ist ein interpreter?'), 'Unterschied zum Assembler?'),
    ).toBe('was ist ein interpreter? Unterschied zum Assembler?')
  })

  it('prepends for an English comparison follow-up', () => {
    expect(
      heuristicContextualizeQuery(hist('what is an interpreter?'), 'how does it differ?'),
    ).toBe('what is an interpreter? how does it differ?')
  })

  // --- bare-fragment follow-ups (attribute of the prior topic) ---
  it('prepends for a one-word attribute fragment', () => {
    expect(heuristicContextualizeQuery(hist('was ist ein interpreter?'), 'Vorteile?')).toBe(
      'was ist ein interpreter? Vorteile?',
    )
  })

  it('prepends for a short elliptical question with no own subject ("wie schnell?")', () => {
    expect(heuristicContextualizeQuery(hist('was ist ein interpreter?'), 'wie schnell?')).toBe(
      'was ist ein interpreter? wie schnell?',
    )
  })

  it('prepends when a bare personal pronoun stands in for the subject', () => {
    expect(
      heuristicContextualizeQuery(hist('was ist ein interpreter?'), 'Wie schnell ist er?'),
    ).toBe('was ist ein interpreter? Wie schnell ist er?')
  })

  it('prepends for "what about X?"', () => {
    expect(heuristicContextualizeQuery(hist('what is an interpreter?'), 'what about Python?')).toBe(
      'what is an interpreter? what about Python?',
    )
  })

  // --- negatives: genuine topic switches must stay standalone ---
  it('leaves a short self-contained definitional question standalone (topic switch)', () => {
    expect(heuristicContextualizeQuery(hist('was ist ein interpreter?'), 'Was ist Rust?')).toBe(
      'Was ist Rust?',
    )
    expect(
      heuristicContextualizeQuery(hist('what is an interpreter?'), 'what is a compiler?'),
    ).toBe('what is a compiler?')
  })

  it('leaves a longer markerless self-contained question standalone', () => {
    const q = 'Wie funktioniert ein Compiler im Detail genau?'
    expect(heuristicContextualizeQuery(hist('was ist ein interpreter?'), q)).toBe(q)
  })
})
