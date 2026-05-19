import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { isSupported, parseFile, ImportError } from '@main/services/documents/parser'

const FIX = resolve(__dirname, 'fixtures')

describe('isSupported', () => {
  it('accepts pdf, md, txt, common code extensions', () => {
    expect(isSupported('foo.pdf')).toBe(true)
    expect(isSupported('foo.md')).toBe(true)
    expect(isSupported('foo.ts')).toBe(true)
    expect(isSupported('foo.go')).toBe(true)
    expect(isSupported('foo.PY')).toBe(true) // case-insensitive
  })
  it('rejects docx (deferred to v0.3)', () => {
    expect(isSupported('foo.docx')).toBe(false)
  })
  it('rejects unknown extensions', () => {
    expect(isSupported('foo.xyz')).toBe(false)
    expect(isSupported('noext')).toBe(false)
  })
})

describe('parseFile (markdown)', () => {
  it('returns one page with the full text', async () => {
    const parsed = await parseFile(resolve(FIX, 'sample.md'))
    expect(parsed.kind).toBe('text')
    expect(parsed.pages).toHaveLength(1)
    expect(parsed.pages[0].num).toBe(1)
    expect(parsed.fullText).toContain('Erste zeile auf deutsch')
    expect(parsed.fullText).toContain('Second paragraph in english')
  })
})

describe('parseFile (source code)', () => {
  it('treats .ts as text', async () => {
    const parsed = await parseFile(resolve(FIX, 'sample.ts'))
    expect(parsed.kind).toBe('text')
    expect(parsed.fullText).toContain('export function hello')
  })
})

describe('parseFile (pdf)', () => {
  it('returns at least one page with non-empty text', async () => {
    const parsed = await parseFile(resolve(FIX, 'sample.pdf'))
    expect(parsed.kind).toBe('pdf')
    expect(parsed.pages.length).toBeGreaterThanOrEqual(1)
    expect(parsed.fullText.length).toBeGreaterThan(0)
  })
})

describe('parseFile (docx)', () => {
  it('throws ImportError for .docx (deferred to v0.3)', async () => {
    await expect(parseFile('foo.docx')).rejects.toBeInstanceOf(ImportError)
  })
})
