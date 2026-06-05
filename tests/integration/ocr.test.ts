import { describe, it, expect, afterAll } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { ocrImageBuffer, terminateOcr } from '@main/services/documents/ocr'

// End-to-end OCR smoke test: render text to an image with @napi-rs/canvas, then
// read it back through the real tesseract.js pipeline (sharp preprocess + the
// offline worker config). Exercises the whole image path without a fixture.
//
// Gated on the traineddata being present (it's gitignored and only fetched via
// `pnpm tessdata`) and on a usable system font, so CI — which has neither —
// skips it cleanly while local dev runs it for real.
const tessdataDir = process.env['LOKLM_TESSDATA_DIR'] ?? join(process.cwd(), 'tessdata')
const haveTessdata =
  existsSync(join(tessdataDir, 'eng.traineddata')) &&
  existsSync(join(tessdataDir, 'deu.traineddata'))
const haveFont = GlobalFonts.families.length > 0

describe.skipIf(!haveTessdata || !haveFont)('OCR end-to-end (offline, needs tessdata)', () => {
  afterAll(async () => {
    await terminateOcr()
  })

  it('recognises rendered text from an image buffer', async () => {
    const canvas = createCanvas(1280, 360)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#000000'
    ctx.font = '140px sans-serif'
    ctx.fillText('Hello World', 60, 220)

    const text = (await ocrImageBuffer(canvas.toBuffer('image/png'))).toLowerCase()
    expect(text).toContain('hello')
    expect(text).toContain('world')
  }, 60_000)
})
