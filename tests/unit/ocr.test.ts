import { describe, it, expect } from 'vitest'
import { pageNeedsOcr, OCR_MIN_PAGE_CHARS } from '@main/services/documents/ocr'

// Pure heuristic that decides whether a PDF page has a real text layer or is a
// scan that must go through OCR. Importing ocr.ts is cheap — tesseract / sharp
// / canvas are all behind dynamic imports inside the functions, not at module
// load — so this runs with no native deps.
describe('pageNeedsOcr', () => {
  it('flags empty / whitespace-only pages as scans', () => {
    expect(pageNeedsOcr('')).toBe(true)
    expect(pageNeedsOcr('   \n\t  ')).toBe(true)
  })

  it('flags pages with only a few stray glyphs as scans', () => {
    expect(pageNeedsOcr('ﬁ')).toBe(true)
    expect(pageNeedsOcr('a b c')).toBe(true) // 5 chars < threshold
  })

  it('treats a real text page as having a text layer', () => {
    const realPage = 'This is a normal page of extracted text with plenty of words on it.'
    expect(realPage.trim().length).toBeGreaterThanOrEqual(OCR_MIN_PAGE_CHARS)
    expect(pageNeedsOcr(realPage)).toBe(false)
  })

  it('uses OCR_MIN_PAGE_CHARS as the boundary', () => {
    const justUnder = 'x'.repeat(OCR_MIN_PAGE_CHARS - 1)
    const atThreshold = 'x'.repeat(OCR_MIN_PAGE_CHARS)
    expect(pageNeedsOcr(justUnder)).toBe(true)
    expect(pageNeedsOcr(atThreshold)).toBe(false)
  })
})
