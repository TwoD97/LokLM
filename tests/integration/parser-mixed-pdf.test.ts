import { afterAll, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { GlobalFonts } from '@napi-rs/canvas'
import { createMixedPdf } from '../fixtures/mixed-pdf'
import { parseFile } from '@main/services/documents/parser'
import { terminateOcr } from '@main/services/documents/ocr'

const tessdata = process.env['LOKLM_TESSDATA_DIR'] ?? join(process.cwd(), 'tessdata')
const available =
  ['eng', 'deu'].every((language) => existsSync(join(tessdata, `${language}.traineddata`))) &&
  GlobalFonts.families.length > 0

describe.skipIf(!available)('mixed selectable/scanned PDF with real offline OCR', () => {
  afterAll(terminateOcr)

  it('preserves page order and text while recognizing only the scanned page', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'loklm-mixed-pdf-'))
    try {
      const path = join(directory, 'mixed.pdf')
      await writeFile(path, createMixedPdf())
      const progress: Array<[number, number]> = []
      const parsed = await parseFile(path, {
        onOcrProgress: (done, total) => progress.push([done, total]),
      })
      expect(parsed.kind).toBe('pdf')
      expect(parsed.pages.map((page) => page.num)).toEqual([1, 2])
      expect(parsed.pages[0]!.text).toContain('ALPHA-TEXT-731')
      expect(parsed.pages[1]!.text).toMatch(/BRAVO\s+SCAN/i)
      expect(parsed.pages[1]!.text).toContain('09:45')
      expect(parsed.pages[1]!.text).toMatch(/Teilnehmerzahl\s+27/i)
      expect(parsed.pages[1]!.text).toContain('B-14')
      expect(progress.at(-1)).toEqual([1, 1])
      expect(progress.every(([, total]) => total === 1)).toBe(true)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }, 60_000)
})
