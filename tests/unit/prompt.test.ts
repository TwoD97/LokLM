import { describe, it, expect } from 'vitest'
import {
  buildPrompt,
  buildSystemPrompt,
  renderFallback,
  stripThink,
  ThinkFilter,
  REFUSAL_TEXT,
  condense,
  chunkifyForStream,
} from '@main/services/llm/prompt'
import type { RetrievalHit } from '@shared/documents'

const hit = (id: number, text: string, title = 'doc.md'): RetrievalHit => ({
  chunk_id: id,
  document_id: id,
  document_title: title,
  ordinal: 0,
  page_from: 1,
  page_to: 1,
  text,
  score: 1.0,
})

describe('buildPrompt', () => {
  it('emits source block with [doc:X, chunk:Y] markers', () => {
    const out = buildPrompt('was steht da?', [hit(5, 'Wir testen Wochenbuch.', 'Wochenbuch.pdf')])
    expect(out).toContain('[doc:5, chunk:5]')
    expect(out).toContain('Wochenbuch.pdf')
    expect(out).toContain('Wir testen Wochenbuch.')
    expect(out).toContain('was steht da?')
  })

  it('emits Context: (none) when no hits', () => {
    const out = buildPrompt('hello', [])
    expect(out).toContain('Context: (none)')
  })

  it('embeds conversation history when provided', () => {
    const out = buildPrompt(
      'follow up',
      [hit(1, 'fact one')],
      [
        { role: 'user', content: 'first question' },
        { role: 'assistant', content: 'first answer' },
      ],
    )
    expect(out).toContain('first question')
    expect(out).toContain('first answer')
    expect(out).toMatch(/Previous conversation/i)
  })

  it('truncates oversized history messages', () => {
    const huge = 'x'.repeat(5000)
    const out = buildPrompt('q', [hit(1, 'fact')], [{ role: 'user', content: huge }])
    expect(out.length).toBeLessThan(huge.length + 2000)
    expect(out).toContain('truncated')
  })

  it('includes page number when present', () => {
    const h = { ...hit(7, 'text'), page_from: 42 }
    const out = buildPrompt('q', [h])
    expect(out).toContain('p.42')
  })
})

describe('buildSystemPrompt', () => {
  it('contains citation discipline + refusal instruction', () => {
    const sys = buildSystemPrompt('de')
    expect(sys.toLowerCase()).toMatch(/doc:|chunk:|cite/i)
  })

  it('contains /no_think directive', () => {
    const sys = buildSystemPrompt('en')
    expect(sys).toMatch(/no_think/)
  })

  it('binds the response language', () => {
    expect(buildSystemPrompt('de')).toContain('German')
    expect(buildSystemPrompt('en')).toContain('English')
  })
})

describe('stripThink', () => {
  it('removes <think>…</think> blocks', () => {
    expect(stripThink('hello <think>internal</think> world')).toBe('hello  world')
  })

  it('removes multiline thinking blocks', () => {
    expect(stripThink('a <think>\nlots\nof\nlines\n</think> b')).toBe('a  b')
  })

  it('leaves text without thinking tags alone', () => {
    expect(stripThink('plain text here')).toBe('plain text here')
  })
})

describe('ThinkFilter', () => {
  it('passes through text with no thinking tags (across feed+flush)', () => {
    // feed() holds back the last few chars in case a '<think>' tag spans a
    // chunk boundary; flush() releases the tail. Real callers always feed
    // streamed pieces and flush at end-of-response.
    const filter = new ThinkFilter()
    const out = filter.feed('clean text') + filter.flush()
    expect(out).toBe('clean text')
  })

  it('strips a single <think>...</think> across multiple chunks', () => {
    const filter = new ThinkFilter()
    const parts = ['hello <thi', 'nk>x</thi', 'nk> world']
    const out = parts.map((p) => filter.feed(p)).join('') + filter.flush()
    expect(out).toContain('hello')
    expect(out).toContain('world')
    expect(out).not.toContain('<think>')
    expect(out).not.toContain('x</think>')
  })

  it('reset() clears buffer state', () => {
    const filter = new ThinkFilter()
    filter.feed('<thi') // partial open held in buffer
    filter.reset()
    const out = filter.feed('hello') + filter.flush()
    expect(out).toBe('hello')
  })
})

describe('renderFallback', () => {
  it('returns a citation-listing string when hits exist', () => {
    const out = renderFallback('q', [hit(2, 'snippet')], 'de')
    expect(out).toContain('[doc:2, chunk:2]')
  })

  it('returns the refusal string when no hits', () => {
    expect(renderFallback('q', [], 'de')).toBe(REFUSAL_TEXT.de)
    expect(renderFallback('q', [], 'en')).toBe(REFUSAL_TEXT.en)
  })
})

describe('REFUSAL_TEXT', () => {
  it('has both de and en variants, non-empty and distinct', () => {
    expect(REFUSAL_TEXT.de.length).toBeGreaterThan(0)
    expect(REFUSAL_TEXT.en.length).toBeGreaterThan(0)
    expect(REFUSAL_TEXT.de).not.toBe(REFUSAL_TEXT.en)
  })
})

describe('condense', () => {
  it('collapses whitespace and trims', () => {
    expect(condense('  hello   world   ', 100)).toBe('hello world')
  })

  it('truncates with ellipsis when over max', () => {
    const out = condense('a'.repeat(200), 10)
    expect(out).toHaveLength(10)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('chunkifyForStream', () => {
  it('returns at least one chunk for non-empty text', () => {
    const out = chunkifyForStream('hello world this is a longer message that will be chunked')
    expect(out.length).toBeGreaterThan(0)
    expect(out.join('')).toContain('hello')
  })

  it('returns empty array for empty input', () => {
    expect(chunkifyForStream('')).toEqual([])
  })
})
