import { describe, it, expect } from 'vitest'
import { existsSync, statSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const REPO_ROOT = path.resolve(__dirname, '../..')

const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8'))
const VERSION = pkg.version
const EXE_PATH = path.join(REPO_ROOT, 'release', `LokLM-Setup-${VERSION}-win-x64.exe`)

const exeMissing = !existsSync(EXE_PATH)

describe.skipIf(exeMissing)('installer artifact smoke test', () => {
  it('exists at the expected path', () => {
    expect(existsSync(EXE_PATH)).toBe(true)
  })

  it('is within the expected size range (60-500 MB)', () => {
    // Upper bound calibrated to the actual artifact size for v0.2.3 (~393 MB)
    // with electron runtime + pdfjs + node-llama-cpp natives + pglite bundled.
    // Sanity check against accidental empty/stub builds (too small) and
    // accidental inclusion of model files (too large).
    const size = statSync(EXE_PATH).size
    const mb = size / (1024 * 1024)
    expect(mb).toBeGreaterThan(60)
    expect(mb).toBeLessThan(500)
  })

  it('is a valid PE32+ binary (NSIS installer is a Windows EXE)', () => {
    const fd = readFileSync(EXE_PATH, { encoding: null })
    expect(fd[0]).toBe(0x4d)
    expect(fd[1]).toBe(0x5a)
    const peOffset = fd.readUInt32LE(0x3c)
    expect(peOffset).toBeGreaterThan(0)
    expect(peOffset).toBeLessThan(fd.length - 4)
    expect(fd[peOffset]).toBe(0x50)
    expect(fd[peOffset + 1]).toBe(0x45)
    expect(fd[peOffset + 2]).toBe(0x00)
    expect(fd[peOffset + 3]).toBe(0x00)
  })

  it('source BMPs exist and are valid BMP3 (24bpp, BI_RGB)', () => {
    // NSIS embeds the welcome/finish sidebar bitmap as a Win32 PE resource
    // (.rsrc section) — the on-disk layout doesn't match a naive substring
    // search and the resource block can be repacked by linkers in ways that
    // shift bytes. Visual confirmation that the BMPs render inside the
    // installer is the job of Task 16 (manual smoke). Here we verify what
    // we can reliably check: the source BMPs the build consumes are valid.
    const installerDir = path.join(REPO_ROOT, 'installer')
    const bmps = [
      { file: 'installer-sidebar.bmp', width: 164, height: 314 },
      { file: 'uninstaller-sidebar.bmp', width: 164, height: 314 },
      { file: 'installer-header.bmp', width: 150, height: 57 },
    ]

    for (const { file, width, height } of bmps) {
      const buf = readFileSync(path.join(installerDir, file))
      expect(buf[0], `${file}: missing 'B' magic`).toBe(0x42)
      expect(buf[1], `${file}: missing 'M' magic`).toBe(0x4d)
      expect(buf.readUInt32LE(14), `${file}: DIB header size != 40 (BMP3)`).toBe(40)
      expect(buf.readInt32LE(18), `${file}: wrong width`).toBe(width)
      expect(buf.readInt32LE(22), `${file}: wrong height`).toBe(height)
      expect(buf.readUInt16LE(28), `${file}: not 24bpp`).toBe(24)
      expect(buf.readUInt32LE(30), `${file}: compression != BI_RGB`).toBe(0)
    }
  })
})
