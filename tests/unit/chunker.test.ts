import { describe, it, expect } from 'vitest'
import { chunkPages } from '@main/services/documents/chunker'
import type { PageText } from '@main/services/documents/types'

describe('chunkPages', () => {
  it('returns one chunk when text fits in maxChars', () => {
    const pages: PageText[] = [{ num: 1, text: 'hello world' }]
    const chunks = chunkPages(pages, { maxChars: 100, overlap: 10 })
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({ ordinal: 0, pageFrom: 1, pageTo: 1, text: 'hello world' })
  })

  it('splits at paragraph boundaries first', () => {
    const text = 'paragraph one.\n\nparagraph two.\n\nparagraph three.'
    const pages: PageText[] = [{ num: 1, text }]
    const chunks = chunkPages(pages, { maxChars: 20, overlap: 0 })
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(20)
  })

  it('falls through sentence then word separators when needed', () => {
    const text = 'A. B. C. D. E. F. G. H. I. J. K. L. M. N.'
    const pages: PageText[] = [{ num: 1, text }]
    const chunks = chunkPages(pages, { maxChars: 12, overlap: 0 })
    expect(chunks.length).toBeGreaterThan(1)
  })

  it('hard-splits long unbreakable text when all separators fail', () => {
    const text = 'a'.repeat(100)
    const pages: PageText[] = [{ num: 1, text }]
    const chunks = chunkPages(pages, { maxChars: 30, overlap: 0 })
    expect(chunks.length).toBeGreaterThanOrEqual(4)
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(30)
  })

  it('preserves page numbers per chunk', () => {
    const pages: PageText[] = [
      { num: 1, text: 'page one short' },
      { num: 7, text: 'page seven short' },
    ]
    const chunks = chunkPages(pages, { maxChars: 100, overlap: 0 })
    expect(chunks).toHaveLength(2)
    expect(chunks[0].pageFrom).toBe(1)
    expect(chunks[1].pageFrom).toBe(7)
  })

  it('assigns sequential ordinals starting at 0 across pages', () => {
    const pages: PageText[] = [
      { num: 1, text: 'a' },
      { num: 2, text: 'b' },
      { num: 3, text: 'c' },
    ]
    const chunks = chunkPages(pages, { maxChars: 10, overlap: 0 })
    expect(chunks.map((c) => c.ordinal)).toEqual([0, 1, 2])
  })

  it('applies overlap (tail of previous chunk prepended to next)', () => {
    const text = 'AAAAA. BBBBB. CCCCC. DDDDD. EEEEE.'
    const pages: PageText[] = [{ num: 1, text }]
    const chunks = chunkPages(pages, { maxChars: 18, overlap: 4 })
    expect(chunks.length).toBeGreaterThan(1)
    const tailOf0 = chunks[0].text.slice(-4)
    expect(chunks[1].text.startsWith(tailOf0) || chunks[1].text.includes(tailOf0)).toBe(true)
    // contract: every chunk respects maxChars even with overlap applied
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(18)
  })

  it('skips empty pages', () => {
    const pages: PageText[] = [
      { num: 1, text: '   \n\n  ' },
      { num: 2, text: 'real content' },
    ]
    const chunks = chunkPages(pages, { maxChars: 100, overlap: 0 })
    expect(chunks).toHaveLength(1)
    expect(chunks[0].pageFrom).toBe(2)
  })

  it('uses defaults when no opts provided', () => {
    const pages: PageText[] = [{ num: 1, text: 'short' }]
    const chunks = chunkPages(pages)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].text).toBe('short')
  })
})
