import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportDocument } from '@main/services/documents/exportDocument'

describe('atomic document export', () => {
  let directory: string
  let destination: string
  beforeEach(async () => {
    directory = await fs.mkdtemp(join(tmpdir(), 'loklm-export-'))
    destination = join(directory, 'report.md')
    await fs.writeFile(destination, 'Existing report')
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(directory, { recursive: true, force: true })
  })

  it('replaces an existing file with complete UTF-8 text and leaves no staging file', async () => {
    await exportDocument(
      destination,
      { text: '# März\n\nReady for review.' },
      new AbortController().signal,
    )
    expect(await fs.readFile(destination, 'utf8')).toBe('# März\n\nReady for review.')
    expect(await fs.readdir(directory)).toEqual(['report.md'])
  })

  it('supports exporting a source onto its own chosen path without truncating it', async () => {
    await exportDocument(destination, { path: destination }, new AbortController().signal)
    expect(await fs.readFile(destination, 'utf8')).toBe('Existing report')
    expect(await fs.readdir(directory)).toEqual(['report.md'])
  })

  it('exports a read-only original without changing its permissions or contents', async () => {
    const source = join(directory, 'read-only.txt')
    await fs.writeFile(source, 'Read-only original')
    await fs.chmod(source, 0o444)
    try {
      await exportDocument(destination, { path: source }, new AbortController().signal)
      expect(await fs.readFile(destination, 'utf8')).toBe('Read-only original')
      expect(await fs.readFile(source, 'utf8')).toBe('Read-only original')
      expect((await fs.stat(source)).mode & 0o200).toBe(0)
    } finally {
      await fs.chmod(source, 0o600)
    }
  })

  it('removes a partial staging write while preserving the previous destination', async () => {
    const realWrite = fs.writeFile.bind(fs)
    vi.spyOn(fs, 'writeFile').mockImplementationOnce(async (path) => {
      await realWrite(path, 'Partial output')
      throw new Error('simulated full disk')
    })
    await expect(
      exportDocument(destination, { text: 'Replacement' }, new AbortController().signal),
    ).rejects.toThrow(/full disk/)
    expect(await fs.readFile(destination, 'utf8')).toBe('Existing report')
    expect(await fs.readdir(directory)).toEqual(['report.md'])
  })

  it('discards a complete copy if the vault locks before publication', async () => {
    const controller = new AbortController()
    const copy = fs.copyFile.bind(fs)
    vi.spyOn(fs, 'copyFile').mockImplementationOnce(async (...args) => {
      await copy(...args)
      controller.abort()
    })
    await expect(
      exportDocument(destination, { path: destination }, controller.signal),
    ).rejects.toThrow(/abort/i)
    expect(await fs.readFile(destination, 'utf8')).toBe('Existing report')
    expect(await fs.readdir(directory)).toEqual(['report.md'])
  })
})
