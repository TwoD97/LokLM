import { describe, it, expect, vi } from 'vitest'
import { resolve } from 'node:path'

// AP-T.1 — exercises parser.ts's OCR / scanned-page code paths WITHOUT a real
// OCR engine or tessdata, so it stays within the "no external services" unit
// constraint. The OCR layer (./ocr) is stubbed; parser.ts's own statements
// (parseImage, ocrScannedPages loop) still execute and get counted.
vi.mock('@main/services/documents/ocr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/documents/ocr')>()
  return {
    ...actual,
    ocrImageFile: vi.fn(async () => 'OCR text from a raster image'),
    pageNeedsOcr: vi.fn(() => true), // force every PDF page down the OCR-backfill path
    ocrPdfPage: vi.fn(async () => 'OCR text from a scanned page'),
  }
})

import { parseFile } from '@main/services/documents/parser'

const FIX = resolve(__dirname, 'fixtures')

describe('parseFile (image → OCR)', () => {
  it('routes a raster image through OCR and returns a single text page', async () => {
    // path is never read — ocrImageFile is mocked — so no real image fixture needed.
    const parsed = await parseFile('scan.png')
    expect(parsed.kind).toBe('text')
    expect(parsed.pages).toHaveLength(1)
    expect(parsed.fullText).toContain('OCR text from a raster image')
  })
})

describe('parsePdf (scanned pages → OCR backfill)', () => {
  it('OCRs pages whose text layer is empty and substitutes the OCR result', async () => {
    const parsed = await parseFile(resolve(FIX, 'sample.pdf'))
    expect(parsed.kind).toBe('pdf')
    // pageNeedsOcr forced true → every page was backfilled with the OCR text.
    expect(parsed.fullText).toContain('OCR text from a scanned page')
  })

  it('reports OCR progress per scanned page', async () => {
    // covers the onOcrProgress callback branch in ocrScannedPages.
    const seen: Array<[number, number]> = []
    const parsed = await parseFile(resolve(FIX, 'sample.pdf'), {
      onOcrProgress: (done, total) => seen.push([done, total]),
    })
    expect(parsed.kind).toBe('pdf')
    expect(seen.length).toBeGreaterThan(0)
    const [, total] = seen[seen.length - 1]!
    expect(seen[seen.length - 1]![0]).toBe(total) // last tick: done === total
  })
})
