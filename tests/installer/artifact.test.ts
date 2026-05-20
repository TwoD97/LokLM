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

  it('is within the expected size range (60-200 MB)', () => {
    const size = statSync(EXE_PATH).size
    const mb = size / (1024 * 1024)
    expect(mb).toBeGreaterThan(60)
    expect(mb).toBeLessThan(200)
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

  it('contains the LokLM sidebar BMP bytes (substring match)', () => {
    const expectedHeader = Buffer.alloc(20)
    expectedHeader.writeUInt32LE(40, 0)
    expectedHeader.writeInt32LE(164, 4)
    expectedHeader.writeInt32LE(314, 8)
    expectedHeader.writeUInt16LE(1, 12)
    expectedHeader.writeUInt16LE(24, 14)
    expectedHeader.writeUInt32LE(0, 16)

    const exe = readFileSync(EXE_PATH)
    const idx = exe.indexOf(expectedHeader)
    expect(idx, 'Sidebar BMP3 header not found in installer payload').toBeGreaterThan(-1)
  })
})
