import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { exportSvgToBmp } from '../../installer/assets/export.mjs'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

describe('exportSvgToBmp', () => {
  let outDir: string

  beforeAll(async () => {
    outDir = await mkdtemp(path.join(tmpdir(), 'loklm-installer-test-'))
  })

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true })
  })

  it('produces a 164x314 BMP3 from a sidebar-shaped SVG', async () => {
    const out = path.join(outDir, 'sidebar.bmp')
    await exportSvgToBmp({
      svgPath: path.resolve(__dirname, 'fixtures/tiny.svg'),
      outPath: out,
      width: 164,
      height: 314,
    })

    const buf = await readFile(out)

    // BMP file header: 'BM' magic at offset 0
    expect(buf[0]).toBe(0x42)
    expect(buf[1]).toBe(0x4d)

    // DIB header size at offset 14 — BMP3 (BITMAPINFOHEADER) is 40 bytes
    const dibHeaderSize = buf.readUInt32LE(14)
    expect(dibHeaderSize).toBe(40)

    // Width at offset 18
    expect(buf.readInt32LE(18)).toBe(164)

    // Height at offset 22
    expect(buf.readInt32LE(22)).toBe(314)

    // Bit depth at offset 28 — must be 24bpp (no alpha)
    expect(buf.readUInt16LE(28)).toBe(24)

    // Compression mode at offset 30 — must be 0 (BI_RGB, uncompressed)
    expect(buf.readUInt32LE(30)).toBe(0)

    const expectedMin = 164 * 314 * 3
    expect(buf.length).toBeGreaterThan(expectedMin)
    expect(buf.length).toBeLessThan(expectedMin * 1.2)
  })

  it('substitutes __VERSION__ from package.json before rendering', async () => {
    const outWith = path.join(outDir, 'with-version.bmp')
    const outWithout = path.join(outDir, 'without-version.bmp')

    await exportSvgToBmp({
      svgPath: path.resolve(__dirname, '../../installer/assets/sidebar.svg'),
      outPath: outWith,
      width: 164,
      height: 314,
      versionToken: '9.9.9-test',
    })

    await exportSvgToBmp({
      svgPath: path.resolve(__dirname, '../../installer/assets/sidebar.svg'),
      outPath: outWithout,
      width: 164,
      height: 314,
      // no versionToken — should leave __VERSION__ literal in the rendered SVG
    })

    const bufWith = await readFile(outWith)
    const bufWithout = await readFile(outWithout)

    // Both must be valid BMPs
    expect(bufWith[0]).toBe(0x42)
    expect(bufWith[1]).toBe(0x4d)
    expect(bufWithout[0]).toBe(0x42)
    expect(bufWithout[1]).toBe(0x4d)

    // The two renderings must differ in the pixel area (different rendered text)
    // BMP file header is the same 54 bytes; skip past it.
    const pixelsWith = bufWith.slice(54)
    const pixelsWithout = bufWithout.slice(54)
    expect(pixelsWith.equals(pixelsWithout)).toBe(false)
  })

  it('produces a 150x57 BMP3 from a header-shaped SVG', async () => {
    const out = path.join(outDir, 'header.bmp')
    await exportSvgToBmp({
      svgPath: path.resolve(__dirname, '../../installer/assets/header.svg'),
      outPath: out,
      width: 150,
      height: 57,
    })

    const buf = await readFile(out)
    // BMP file header: 'BM' magic at offset 0
    expect(buf[0]).toBe(0x42)
    expect(buf[1]).toBe(0x4d)
    // Width at offset 18
    expect(buf.readInt32LE(18)).toBe(150)
    // Height at offset 22
    expect(buf.readInt32LE(22)).toBe(57)
    // Bit depth at offset 28 — must be 24bpp (no alpha)
    expect(buf.readUInt16LE(28)).toBe(24)
  })
})
