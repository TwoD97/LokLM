import { describe, it, expect } from 'vitest'
import { chunkPages, chunkMarkdown, tagChunksWithSections } from '@main/services/documents/chunker'
import type { MarkdownSection, PageText, PdfSection } from '@main/services/documents/types'

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

  it('returns null headingPath for non-markdown content', () => {
    const pages: PageText[] = [{ num: 1, text: 'plain page' }]
    const [c] = chunkPages(pages)
    expect(c?.headingPath).toBeNull()
  })
})

describe('chunkMarkdown', () => {
  it('emits one chunk per section under maxChars', () => {
    const sections: MarkdownSection[] = [
      { headingPath: ['Intro'], text: 'intro body' },
      { headingPath: ['Intro', 'Why'], text: 'why body' },
    ]
    const chunks = chunkMarkdown(sections, { maxChars: 200, overlap: 0 })
    expect(chunks).toHaveLength(2)
    expect(chunks[0]!.headingPath).toEqual(['Intro'])
    expect(chunks[1]!.headingPath).toEqual(['Intro', 'Why'])
  })

  it('prefixes each chunk with its own heading so the embedding picks it up', () => {
    const sections: MarkdownSection[] = [{ headingPath: ['Auth'], text: 'argon2id is the KDF.' }]
    const [c] = chunkMarkdown(sections, { maxChars: 200, overlap: 0 })
    expect(c?.text.startsWith('# Auth\n\n')).toBe(true)
    expect(c?.text).toContain('argon2id is the KDF.')
  })

  it('leaves pageFrom/pageTo null for markdown chunks', () => {
    const sections: MarkdownSection[] = [{ headingPath: ['A'], text: 'body' }]
    const [c] = chunkMarkdown(sections)
    expect(c?.pageFrom).toBeNull()
    expect(c?.pageTo).toBeNull()
  })

  it('returns null headingPath for preamble sections (content above first heading)', () => {
    const sections: MarkdownSection[] = [{ headingPath: [], text: 'just an intro paragraph' }]
    const [c] = chunkMarkdown(sections)
    expect(c?.headingPath).toBeNull()
    expect(c?.text).toBe('just an intro paragraph')
  })

  it('skips sections whose body is whitespace-only', () => {
    const sections: MarkdownSection[] = [
      { headingPath: ['Empty'], text: '   ' },
      { headingPath: ['Full'], text: 'real content' },
    ]
    const chunks = chunkMarkdown(sections)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.headingPath).toEqual(['Full'])
  })

  it('splits an oversized section but every piece keeps the same headingPath', () => {
    const long = Array.from({ length: 40 }, (_, i) => `sentence ${i}.`).join(' ')
    const sections: MarkdownSection[] = [{ headingPath: ['Big'], text: long }]
    const chunks = chunkMarkdown(sections, { maxChars: 80, overlap: 0 })
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.headingPath).toEqual(['Big'])
    // Only the first piece carries the heading prefix
    expect(chunks[0]!.text.startsWith('# Big')).toBe(true)
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.text.startsWith('# Big')).toBe(false)
    }
  })

  it('keeps ordinals sequential across sections', () => {
    const sections: MarkdownSection[] = [
      { headingPath: ['A'], text: 'a' },
      { headingPath: ['B'], text: 'b' },
      { headingPath: ['C'], text: 'c' },
    ]
    const chunks = chunkMarkdown(sections)
    expect(chunks.map((c) => c.ordinal)).toEqual([0, 1, 2])
  })

  it('never merges two adjacent sections into one chunk (so citations stay accurate)', () => {
    const sections: MarkdownSection[] = [
      { headingPath: ['A'], text: 'tiny one' },
      { headingPath: ['B'], text: 'tiny two' },
    ]
    const chunks = chunkMarkdown(sections, { maxChars: 10000, overlap: 0 })
    expect(chunks).toHaveLength(2)
    expect(chunks[0]!.headingPath).toEqual(['A'])
    expect(chunks[1]!.headingPath).toEqual(['B'])
  })
})

describe('tagChunksWithSections', () => {
  const baseChunks = (pages: number[]) =>
    pages.map((p, i) => ({
      text: `chunk on page ${p}`,
      ordinal: i,
      pageFrom: p,
      pageTo: p,
      headingPath: null,
    }))

  it('returns chunks unchanged when sections is empty', () => {
    const chunks = baseChunks([1, 2, 3])
    const out = tagChunksWithSections(chunks, [])
    expect(out).toEqual(chunks)
  })

  it('assigns each chunk the deepest section whose pageStart is <= chunk.pageFrom', () => {
    const sections: PdfSection[] = [
      { headingPath: ['Chapter 1'], pageStart: 2 },
      { headingPath: ['Chapter 1', '1.1'], pageStart: 4 },
      { headingPath: ['Chapter 2'], pageStart: 10 },
    ]
    const out = tagChunksWithSections(baseChunks([1, 2, 3, 5, 10, 15]), sections)
    expect(out.map((c) => c.headingPath)).toEqual([
      null, // before first bookmark
      ['Chapter 1'],
      ['Chapter 1'],
      ['Chapter 1', '1.1'],
      ['Chapter 2'],
      ['Chapter 2'],
    ])
  })

  it('leaves headingPath null for chunks without a pageFrom (markdown leftovers)', () => {
    const sections: PdfSection[] = [{ headingPath: ['X'], pageStart: 1 }]
    const out = tagChunksWithSections(
      [{ text: 'no page', ordinal: 0, pageFrom: null, pageTo: null, headingPath: null }],
      sections,
    )
    expect(out[0]!.headingPath).toBeNull()
  })

  it('preserves other chunk fields', () => {
    const sections: PdfSection[] = [{ headingPath: ['X'], pageStart: 1 }]
    const out = tagChunksWithSections(baseChunks([1]), sections)
    expect(out[0]).toMatchObject({
      text: 'chunk on page 1',
      ordinal: 0,
      pageFrom: 1,
      pageTo: 1,
      headingPath: ['X'],
    })
  })
})
