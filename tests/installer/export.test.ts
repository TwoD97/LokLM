import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { exportSvgToBmp } from '../../installer/assets/export.mjs'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

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

    expect(buf[0]).toBe(0x42)
    expect(buf[1]).toBe(0x4d)

    const dibHeaderSize = buf.readUInt32LE(14)
    expect(dibHeaderSize).toBe(40)

    expect(buf.readInt32LE(18)).toBe(164)
    expect(buf.readInt32LE(22)).toBe(314)

    expect(buf.readUInt16LE(28)).toBe(24)
    expect(buf.readUInt32LE(30)).toBe(0)

    const expectedMin = 164 * 314 * 3
    expect(buf.length).toBeGreaterThan(expectedMin)
    expect(buf.length).toBeLessThan(expectedMin * 1.2)
  })

  it('substitutes __VERSION__ from package.json before rendering', async () => {
    const out = path.join(outDir, 'real.bmp')
    await exportSvgToBmp({
      svgPath: path.resolve(__dirname, '../../installer/assets/sidebar.svg'),
      outPath: out,
      width: 164,
      height: 314,
      versionToken: '9.9.9-test',
    })

    const buf = await readFile(out)
    expect(buf[0]).toBe(0x42)
    expect(buf[1]).toBe(0x4d)
    expect(buf.length).toBeGreaterThan(164 * 314 * 3)
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
    expect(buf[0]).toBe(0x42)
    expect(buf[1]).toBe(0x4d)
    expect(buf.readInt32LE(18)).toBe(150)
    expect(buf.readInt32LE(22)).toBe(57)
    expect(buf.readUInt16LE(28)).toBe(24)
  })
})
