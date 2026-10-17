import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ModelDownloader, type DownloadEvent } from '@main/services/models/ModelDownloader'
import { getDownloadTargetDir } from '@main/services/models/paths'

vi.mock('@main/services/models/paths', () => ({
  getDownloadTargetDir: vi.fn(),
  resolveModelFile: vi.fn(),
}))

const payload = Buffer.from('Verified model bytes. '.repeat(1024))
const half = payload.length / 2
const entry = {
  id: 'fixture',
  filename: 'model.gguf',
  url: 'https://models.example/fixture',
  sizeBytes: payload.length,
  sha256: createHash('sha256').update(payload).digest('hex'),
}
const fetchMock = vi.fn<typeof fetch>()
let directory: string
let target: string
let partial: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'loklm-resume-'))
  target = join(directory, entry.filename)
  partial = `${target}.partial`
  vi.mocked(getDownloadTargetDir).mockReturnValue(directory)
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  rmSync(directory, { recursive: true, force: true })
})

function remainder() {
  return new Response(payload.subarray(half), {
    status: 206,
    headers: {
      'content-range': `bytes ${half}-${payload.length - 1}/${payload.length}`,
      'content-length': String(half),
    },
  })
}

describe('verified model download resume', () => {
  it('downloads only missing bytes and verifies both the saved prefix and the suffix', async () => {
    writeFileSync(partial, payload.subarray(0, half))
    fetchMock.mockResolvedValue(remainder())
    const downloader = new ModelDownloader()
    const events: DownloadEvent[] = []
    downloader.onProgress((event) => events.push(event))

    await downloader.downloadEntry(entry)

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      entry.url,
      expect.objectContaining({ headers: { Range: `bytes=${half}-` } }),
    )
    expect(events[0]).toMatchObject({ phase: 'verifying', bytesReceived: half })
    expect(events.at(-1)).toMatchObject({ phase: 'complete', bytesReceived: payload.length })
    expect(readFileSync(target)).toEqual(payload)
    expect(existsSync(partial)).toBe(false)
    expect(downloader.hasAnyActive()).toBe(false)
  })

  it('rejects a corrupt saved prefix even if the new suffix and total size are correct', async () => {
    writeFileSync(partial, Buffer.alloc(half, 42))
    fetchMock.mockResolvedValue(remainder())
    const downloader = new ModelDownloader()
    await expect(downloader.downloadEntry(entry)).rejects.toThrow('SHA256 mismatch')
    expect(existsSync(target)).toBe(false)
    expect(existsSync(partial)).toBe(false)
    expect(downloader.hasAnyActive()).toBe(false)
  })

  it('resets the digest and truncates the prefix when the server sends the whole file', async () => {
    writeFileSync(partial, payload.subarray(0, half))
    fetchMock.mockResolvedValue(new Response(payload))
    await new ModelDownloader().downloadEntry(entry)
    expect(readFileSync(target)).toEqual(payload)
    expect(existsSync(partial)).toBe(false)
  })

  it('rejects a prefix edited while waiting for response headers', async () => {
    writeFileSync(partial, payload.subarray(0, half))
    const replacement = Buffer.alloc(half, 42)
    fetchMock.mockImplementation(async () => {
      // Delayed HTTP headers leave time for another process to replace the
      // already-hashed prefix. The untouched suffix alone still hashes correctly.
      rmSync(partial)
      writeFileSync(partial, replacement)
      return remainder()
    })
    await expect(new ModelDownloader().downloadEntry(entry)).rejects.toThrow(
      'Partial model changed',
    )
    expect(readFileSync(partial)).toEqual(replacement)
    expect(existsSync(target)).toBe(false)
  })

  it('rejects a short range body even when its length is within the manifest tolerance', async () => {
    writeFileSync(partial, payload.subarray(0, half))
    fetchMock.mockResolvedValue(
      new Response(payload.subarray(half, payload.length - 5), {
        status: 206,
        headers: { 'content-range': `bytes ${half}-${payload.length - 1}/${payload.length}` },
      }),
    )
    const sizeOnly = {
      id: entry.id,
      filename: entry.filename,
      url: entry.url,
      sizeBytes: entry.sizeBytes,
    }
    await expect(new ModelDownloader().downloadEntry(sizeOnly)).rejects.toThrow('declared range')
    expect(existsSync(target)).toBe(false)
    expect(readFileSync(partial)).toEqual(payload.subarray(0, payload.length - 5))
  })

  it.each([
    null,
    `bytes 0-${half - 1}/${payload.length}`,
    `bytes ${half}-${half - 1}/${payload.length}`,
    `bytes ${half}-${payload.length - 2}/${payload.length}`,
    `bytes ${half}-9007199254740992/9007199254740993`,
  ])('preserves the partial and releases a rejected range response: %s', async (contentRange) => {
    const prefix = payload.subarray(0, half)
    writeFileSync(partial, prefix)
    const cancel = vi.fn()
    fetchMock.mockResolvedValueOnce(
      new Response(new ReadableStream({ cancel }), {
        status: 206,
        headers: contentRange ? { 'content-range': contentRange } : {},
      }),
    )
    const downloader = new ModelDownloader()
    // Size-only downloads need this protection too; an incorrect range can
    // have the right byte count without containing the right model bytes.
    const sizeOnly = {
      id: entry.id,
      filename: entry.filename,
      url: entry.url,
      sizeBytes: entry.sizeBytes,
    }
    await expect(downloader.downloadEntry(sizeOnly)).rejects.toThrow('invalid resume range')
    expect(readFileSync(partial)).toEqual(prefix)
    expect(existsSync(target)).toBe(false)
    expect(cancel).toHaveBeenCalledOnce()
    expect(downloader.hasAnyActive()).toBe(false)

    fetchMock.mockResolvedValueOnce(remainder())
    await downloader.downloadEntry(entry)
    expect(readFileSync(target)).toEqual(payload)
  })

  it('cancels prefix verification without deleting downloaded bytes or starting fetch', async () => {
    const prefix = payload.subarray(0, half)
    writeFileSync(partial, prefix)
    const downloader = new ModelDownloader()
    const events: DownloadEvent[] = []
    downloader.onProgress((event) => {
      events.push(event)
      if (event.phase === 'verifying') downloader.cancel(event.id)
    })
    await downloader.downloadEntry(entry)
    expect(events.at(-1)?.phase).toBe('cancelled')
    expect(readFileSync(partial)).toEqual(prefix)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(downloader.hasAnyActive()).toBe(false)
  })

  it('releases HTTP error bodies and retains the prefix for retry', async () => {
    const prefix = payload.subarray(0, half)
    writeFileSync(partial, prefix)
    const cancel = vi.fn()
    fetchMock.mockResolvedValue(new Response(new ReadableStream({ cancel }), { status: 503 }))
    await expect(new ModelDownloader().downloadEntry(entry)).rejects.toThrow('HTTP 503')
    expect(readFileSync(partial)).toEqual(prefix)
    expect(cancel).toHaveBeenCalledOnce()
  })
})
