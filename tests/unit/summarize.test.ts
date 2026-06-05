import { describe, it, expect } from 'vitest'
import { packContentWindows } from '@main/services/summarize/SummarizationService'
import { buildSummaryPrompt } from '@main/services/summarize/prompt'
import type { ChunkRow } from '@main/db/database'

const chunk = (id: number, text: string, tokens: number): ChunkRow => ({
  id,
  document_id: 1,
  ordinal: id,
  text,
  token_count: tokens,
  page_from: null,
  page_to: null,
  heading_path: null,
  language: null,
})

describe('packContentWindows', () => {
  it('returns a single window when the doc fits the budget', () => {
    const chunks = [chunk(1, 'a', 100), chunk(2, 'b', 100), chunk(3, 'c', 100)]
    const windows = packContentWindows(chunks, 1000)
    expect(windows).toHaveLength(1)
    expect(windows[0]).toBe('a\n\nb\n\nc')
  })

  it('splits into consecutive windows when over budget (map step)', () => {
    const chunks = [chunk(1, 'a', 100), chunk(2, 'b', 100), chunk(3, 'c', 100)]
    // budget 250: a+b = 200 fit, c would be 300 → new window.
    const windows = packContentWindows(chunks, 250)
    expect(windows).toHaveLength(2)
    expect(windows[0]).toBe('a\n\nb')
    expect(windows[1]).toBe('c')
  })

  it('falls back to char estimate when token_count is null', () => {
    const big = 'x'.repeat(3500) // ~1000 tokens at 3.5 chars/token
    const c = { ...chunk(1, big, 0), token_count: null }
    const windows = packContentWindows([c, c], 1500)
    // Each ~1000 tokens, budget 1500 → can't co-locate two → 2 windows.
    expect(windows).toHaveLength(2)
  })
})

describe('buildSummaryPrompt', () => {
  it('builds an English whole-doc prompt with title + body + language directive', () => {
    const p = buildSummaryPrompt('en', 'My Notes', 'the body text', 'whole')
    expect(p).toContain('My Notes')
    expect(p).toContain('the body text')
    expect(p).toMatch(/in English/)
    expect(p.trimEnd().endsWith('Summary:')).toBe(true)
  })

  it('builds a German whole-doc prompt natively', () => {
    const p = buildSummaryPrompt('de', 'Meine Notizen', 'der Textkörper', 'whole')
    expect(p).toContain('Meine Notizen')
    expect(p).toMatch(/auf Deutsch/)
    expect(p.trimEnd().endsWith('Zusammenfassung:')).toBe(true)
  })

  it('uses excerpt phrasing for the map step', () => {
    expect(buildSummaryPrompt('en', 't', 'b', 'partial')).toMatch(/excerpt/i)
    expect(buildSummaryPrompt('de', 't', 'b', 'partial')).toMatch(/Auszug/)
  })

  it('uses combine phrasing for the reduce step', () => {
    expect(buildSummaryPrompt('en', 't', 'b', 'reduce')).toMatch(/Combined summary:/)
    expect(buildSummaryPrompt('de', 't', 'b', 'reduce')).toMatch(/Kombinierte Zusammenfassung:/)
  })
})
