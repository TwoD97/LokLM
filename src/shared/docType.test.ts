import { describe, it, expect } from 'vitest'
import { classifyDocType, splitSentinels, LIBRARY_DOC_TYPES } from './docType'

describe('classifyDocType', () => {
  it('classifies by extension', () => {
    expect(classifyDocType('/a/b/report.pdf')).toBe('pdf')
    expect(classifyDocType('/a/b/notes.md')).toBe('md')
    expect(classifyDocType('/a/b/notes.markdown')).toBe('md')
    expect(classifyDocType('/a/b/readme.txt')).toBe('txt')
    expect(classifyDocType('/a/b/spec.rst')).toBe('txt')
    expect(classifyDocType('/a/b/letter.docx')).toBe('docx')
  })

  it('buckets code and markup extensions as code', () => {
    for (const p of [
      'x.ts',
      'x.tsx',
      'x.js',
      'x.py',
      'x.go',
      'x.rs',
      'x.json',
      'x.yaml',
      'x.yml',
      'x.html',
      'x.css',
      'x.sql',
      'x.xml',
      'x.sh',
    ]) {
      expect(classifyDocType(p)).toBe('code')
    }
  })

  it('is case-insensitive on the extension', () => {
    expect(classifyDocType('/X/REPORT.PDF')).toBe('pdf')
    expect(classifyDocType('/X/Letter.DOCX')).toBe('docx')
    expect(classifyDocType('/X/NOTES.MD')).toBe('md')
  })

  it('falls back to txt for unknown / extensionless paths', () => {
    expect(classifyDocType('/a/b/mystery.xyz')).toBe('txt')
    expect(classifyDocType('/a/b/Makefile')).toBe('txt')
    expect(classifyDocType('')).toBe('txt')
  })

  it('uses mime_type as a tiebreaker when the extension is missing', () => {
    expect(classifyDocType('/scan-no-ext', 'application/pdf')).toBe('pdf')
    expect(
      classifyDocType(
        '/doc-no-ext',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toBe('docx')
  })

  it('prefers a definite extension over a conflicting mime', () => {
    // a .md file mislabelled as octet-stream is still markdown
    expect(classifyDocType('/a/notes.md', 'application/octet-stream')).toBe('md')
  })
})

describe('LIBRARY_DOC_TYPES', () => {
  it('lists exactly the five buckets', () => {
    expect([...LIBRARY_DOC_TYPES].sort()).toEqual(['code', 'docx', 'md', 'pdf', 'txt'])
  })
})

describe('splitSentinels', () => {
  it('returns a single plain segment when there are no markers', () => {
    expect(splitSentinels('just plain text')).toEqual([
      { text: 'just plain text', highlighted: false },
    ])
  })

  it('marks the wrapped span as highlighted', () => {
    expect(splitSentinels('⟦foo⟧')).toEqual([{ text: 'foo', highlighted: true }])
  })

  it('interleaves plain and highlighted segments in order', () => {
    expect(splitSentinels('a⟦b⟧c⟦d⟧')).toEqual([
      { text: 'a', highlighted: false },
      { text: 'b', highlighted: true },
      { text: 'c', highlighted: false },
      { text: 'd', highlighted: true },
    ])
  })

  it('drops empty segments (adjacent markers, leading/trailing)', () => {
    expect(splitSentinels('⟦x⟧⟦y⟧')).toEqual([
      { text: 'x', highlighted: true },
      { text: 'y', highlighted: true },
    ])
  })

  it('returns an empty array for an empty string', () => {
    expect(splitSentinels('')).toEqual([])
  })
})
