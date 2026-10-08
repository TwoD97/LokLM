import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readIndexedPdf } from './readIndexedPdf'

const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const original = Buffer.from('%PDF-1.7 original source')
let directory: string
let source: { sourcePath: string; mimeType: string | null; contentHash: string | null }

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'loklm-indexed-pdf-'))
  source = {
    sourcePath: join(directory, 'source.pdf'),
    mimeType: 'application/pdf',
    contentHash: hash(original),
  }
  await writeFile(source.sourcePath, original)
})
afterEach(async () => {
  const target = resolve(directory)
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('loklm-indexed-pdf-'))
    throw new Error('Refusing cleanup outside this test’s temporary directory')
  await rm(target, { recursive: true, force: true })
})

describe('indexed PDF source verification', () => {
  it('returns the exact bytes whose SHA-256 matches the indexed version', async () => {
    const result = await readIndexedPdf(source, source.contentHash)
    expect(result).toEqual({ status: 'verified', bytes: new Uint8Array(original) })
  })

  it('rejects same-length replacements even when the file timestamp is preserved', async () => {
    const metadata = await stat(source.sourcePath)
    const replacement = Buffer.from('%PDF-1.7 changed! source')
    expect(replacement.length).toBe(original.length)
    await writeFile(source.sourcePath, replacement)
    await utimes(source.sourcePath, metadata.atime, metadata.mtime)
    expect(await readIndexedPdf(source, source.contentHash)).toEqual({ status: 'changed' })
  })

  it('rejects a newer indexed version than the citation metadata the reader opened', async () => {
    expect(await readIndexedPdf(source, hash(Buffer.from('older indexed version')))).toEqual({
      status: 'changed',
    })
  })

  it.each([null, '', 'invalid-hash'])(
    'fails closed for missing/invalid indexed hash %s',
    async (value) => {
      expect(await readIndexedPdf({ ...source, contentHash: value })).toEqual({
        status: 'unverified',
      })
    },
  )

  it('does not treat missing citation-version metadata as permission to show newer bytes', async () => {
    expect(await readIndexedPdf(source, null)).toEqual({ status: 'unverified' })
  })

  it.each([42, {}, [], 'malformed-hash'])(
    'rejects malformed raw IPC version metadata without throwing: %s',
    async (value) => {
      expect(await readIndexedPdf(source, value)).toEqual({ status: 'unverified' })
    },
  )

  it('allows a managed internal PDF with the same verified content', async () => {
    const managed = join(directory, 'managed')
    await mkdir(managed)
    const sourcePath = join(managed, 'owned.pdf')
    await writeFile(sourcePath, original)
    expect(await readIndexedPdf({ ...source, sourcePath })).toEqual({
      status: 'verified',
      bytes: new Uint8Array(await readFile(sourcePath)),
    })
  })

  it('returns an unavailable status for removed or non-PDF source files', async () => {
    await rm(source.sourcePath)
    expect(await readIndexedPdf(source)).toEqual({ status: 'unavailable' })
    expect(await readIndexedPdf(null)).toEqual({ status: 'unavailable' })
    expect(
      await readIndexedPdf({ ...source, sourcePath: 'note.txt', mimeType: 'text/plain' }),
    ).toEqual({ status: 'unavailable' })
  })

  it('propagates cancellation instead of presenting a successful fallback', async () => {
    const controller = new AbortController()
    const reason = new Error('Session closed')
    controller.abort(reason)
    await expect(readIndexedPdf(source, undefined, controller.signal)).rejects.toBe(reason)
  })
})
