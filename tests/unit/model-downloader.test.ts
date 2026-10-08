/**
 * Downloader tests that exercise the network path against a local fixture
 * HTTP server. Validates:
 *   - SHA256 verify pass + fail
 *   - Size-only verify pass + fail
 *   - Range/resume against a partial file
 *   - Server returning 200 instead of 206 (we discard the partial)
 *   - Cancellation leaves the partial in place
 *   - Progress events fire and report final phase
 *
 * The downloader's manifest lookup is mocked so we don't hit HuggingFace.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ModelDownloader, type DownloadEvent } from '../../src/main/services/models/ModelDownloader'
import * as paths from '../../src/main/services/models/paths'
import * as manifest from '../../src/main/services/models/manifest'
import { checkOne } from '../../src/main/services/models/availability'
import * as installedManifest from '../../src/main/services/models/installedManifest'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    createReadStream: vi.fn(actual.createReadStream),
    renameSync: vi.fn(actual.renameSync),
    writeFileSync: vi.fn(actual.writeFileSync),
  }
})

const PAYLOAD = Buffer.alloc(64 * 1024)
for (let i = 0; i < PAYLOAD.length; i++) PAYLOAD[i] = i & 0xff
const PAYLOAD_SHA = createHash('sha256').update(PAYLOAD).digest('hex')

let server: Server
let baseUrl: string
let tmpDir: string

beforeEach(async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  vi.mocked(fs.createReadStream).mockReset().mockImplementation(actual.createReadStream)
  vi.mocked(fs.renameSync).mockReset().mockImplementation(actual.renameSync)
  vi.mocked(fs.writeFileSync).mockReset().mockImplementation(actual.writeFileSync)
  tmpDir = mkdtempSync(join(tmpdir(), 'loklm-dl-'))
  // Stub the download target so the downloader writes into a throwaway dir.
  vi.spyOn(paths, 'getDownloadTargetDir').mockReturnValue(tmpDir)
  vi.spyOn(paths, 'resolveModelFile').mockImplementation((filename) => {
    const candidate = join(tmpDir, filename)
    return existsSync(candidate) ? candidate : null
  })

  server = createServer((req, res) => {
    if (req.url === '/unavailable') {
      res.writeHead(503)
      res.end()
      return
    }
    const range = req.headers['range'] as string | undefined
    const hadRange = Boolean(range)
    const m = range ? /^bytes=(\d+)-/.exec(range) : null
    const start = m ? parseInt(m[1]!, 10) : 0
    // Test-controlled override: requests to /no-range pretend the server
    // doesn't speak ranges (always returns 200 + full body).
    if (req.url?.startsWith('/no-range')) {
      res.statusCode = 200
      res.setHeader('content-length', String(PAYLOAD.length))
      res.end(PAYLOAD)
      return
    }
    if (req.url?.startsWith('/slow') && start === 0) {
      // Drip the first chunk, then close — exercises the resume path.
      res.statusCode = 200
      res.setHeader('content-length', String(PAYLOAD.length))
      const half = PAYLOAD.length >> 1
      res.write(PAYLOAD.subarray(0, half))
      setTimeout(() => res.destroy(), 20)
      return
    }
    if (hadRange) {
      res.statusCode = 206
      res.setHeader('content-range', `bytes ${start}-${PAYLOAD.length - 1}/${PAYLOAD.length}`)
      res.setHeader('content-length', String(PAYLOAD.length - start))
      res.end(PAYLOAD.subarray(start))
    } else {
      res.statusCode = 200
      res.setHeader('content-length', String(PAYLOAD.length))
      res.end(PAYLOAD)
    }
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw new Error('failed to bind')
  baseUrl = `http://127.0.0.1:${addr.port}`
})

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  rmSync(tmpDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

import { vi } from 'vitest'

function withFixtureManifest<T>(
  url: string,
  opts: { sha256?: string; sizeBytes?: number } = {},
  cb: () => T | Promise<T>,
): T | Promise<T> {
  vi.spyOn(manifest, 'getManifestEntry').mockImplementation((id) => {
    if (id !== 'fixture') return undefined
    return {
      id: 'fixture',
      label: 'Fixture',
      description: 'test fixture',
      kind: 'llm',
      filename: 'fixture.bin',
      url,
      sizeBytes: opts.sizeBytes ?? PAYLOAD.length,
      ...(opts.sha256 ? { sha256: opts.sha256 } : {}),
      required: true,
    }
  })
  return cb()
}

async function collect(dl: ModelDownloader, work: () => Promise<void>): Promise<DownloadEvent[]> {
  const events: DownloadEvent[] = []
  const off = dl.onProgress((ev) => events.push(ev))
  try {
    await work()
  } finally {
    off()
  }
  return events
}

describe('ModelDownloader', () => {
  it.each(['directory creation', 'target lookup'] as const)(
    'reports a %s failure and lets the same downloader retry',
    async (failure) => {
      const obstruction = join(tmpDir, 'blocked')
      if (failure === 'directory creation') {
        writeFileSync(obstruction, 'not a directory')
        vi.mocked(paths.getDownloadTargetDir).mockReturnValue(join(obstruction, 'models'))
      } else {
        vi.mocked(paths.getDownloadTargetDir).mockImplementationOnce(() => {
          throw new Error('Download location unavailable')
        })
      }
      await withFixtureManifest(`${baseUrl}/ok`, { sha256: PAYLOAD_SHA }, async () => {
        const dl = new ModelDownloader()
        const events: DownloadEvent[] = []
        dl.onProgress((event) => events.push(event))
        await expect(dl.download('fixture')).rejects.toThrow()
        expect(dl.isActive('fixture')).toBe(false)
        expect(dl.hasAnyActive()).toBe(false)
        expect(events).toEqual([
          expect.objectContaining({ phase: 'error', id: 'fixture', bytesReceived: 0 }),
        ])
        vi.mocked(paths.getDownloadTargetDir).mockReturnValue(tmpDir)
        await dl.download('fixture')
        expect(readFileSync(join(tmpDir, 'fixture.bin')).equals(PAYLOAD)).toBe(true)
        expect(events.at(-1)?.phase).toBe('complete')
        expect(dl.hasAnyActive()).toBe(false)
      })
    },
  )

  it('verifies an existing pinned file without fetching it again', async () => {
    writeFileSync(join(tmpDir, 'fixture.bin'), PAYLOAD)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await withFixtureManifest(`${baseUrl}/ok`, { sha256: PAYLOAD_SHA.toUpperCase() }, async () => {
      const dl = new ModelDownloader()
      const events = await collect(dl, () => dl.download('fixture'))
      expect(events.map((event) => event.phase)).toEqual(['verifying', 'complete'])
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(readFileSync(join(tmpDir, 'fixture.bin')).equals(PAYLOAD)).toBe(true)
      expect(dl.hasAnyActive()).toBe(false)
    })
  })

  it('repairs a same-size corrupt pinned file instead of reporting it complete', async () => {
    writeFileSync(join(tmpDir, 'fixture.bin'), Buffer.alloc(PAYLOAD.length, 17))
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await withFixtureManifest(`${baseUrl}/ok`, { sha256: PAYLOAD_SHA }, async () => {
      const dl = new ModelDownloader()
      const events = await collect(dl, () => dl.download('fixture'))
      expect(readFileSync(join(tmpDir, 'fixture.bin')).equals(PAYLOAD)).toBe(true)
      expect(fetchSpy).toHaveBeenCalledOnce()
      expect(events[0]?.phase).toBe('verifying')
      expect(events.filter((event) => event.phase === 'complete')).toHaveLength(1)
      expect(events.at(-1)?.phase).toBe('complete')
      expect(existsSync(join(tmpDir, 'fixture.bin.partial'))).toBe(false)
    })
  })

  it('preserves an existing file when verification cannot read it and retries safely', async () => {
    const target = join(tmpDir, 'fixture.bin')
    writeFileSync(target, PAYLOAD)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    vi.mocked(fs.createReadStream).mockImplementationOnce(() => {
      throw new Error('EACCES: model file temporarily unavailable')
    })
    await withFixtureManifest(`${baseUrl}/ok`, { sha256: PAYLOAD_SHA }, async () => {
      const dl = new ModelDownloader()
      const events: DownloadEvent[] = []
      dl.onProgress((event) => events.push(event))
      await expect(dl.download('fixture')).rejects.toThrow(/EACCES/)
      expect(events.map((event) => event.phase)).toEqual(['verifying', 'error'])
      expect(readFileSync(target).equals(PAYLOAD)).toBe(true)
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(dl.hasAnyActive()).toBe(false)
      await dl.download('fixture')
      expect(events.at(-1)?.phase).toBe('complete')
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  it('retains the size-only fast path for an existing unpinned file', async () => {
    writeFileSync(join(tmpDir, 'fixture.bin'), PAYLOAD)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await withFixtureManifest(`${baseUrl}/ok`, {}, async () => {
      const dl = new ModelDownloader()
      const events = await collect(dl, () => dl.download('fixture'))
      expect(events.map((event) => event.phase)).toEqual(['complete'])
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  it('cancels verification without deleting the existing file and can retry', async () => {
    const target = join(tmpDir, 'fixture.bin')
    writeFileSync(target, PAYLOAD)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await withFixtureManifest(`${baseUrl}/ok`, { sha256: PAYLOAD_SHA }, async () => {
      const dl = new ModelDownloader()
      const events: DownloadEvent[] = []
      const off = dl.onProgress((event) => {
        events.push(event)
        if (event.phase === 'verifying') dl.cancel(event.id)
      })
      await dl.download('fixture')
      expect(events.map((event) => event.phase)).toEqual(['verifying', 'cancelled'])
      expect(readFileSync(target).equals(PAYLOAD)).toBe(true)
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(dl.hasAnyActive()).toBe(false)
      off()
      expect((await collect(dl, () => dl.download('fixture'))).at(-1)?.phase).toBe('complete')
    })
  })

  it('never publishes a repair whose replacement also fails verification', async () => {
    writeFileSync(join(tmpDir, 'fixture.bin'), Buffer.alloc(PAYLOAD.length, 17))
    await withFixtureManifest(`${baseUrl}/ok`, { sha256: 'a'.repeat(64) }, async () => {
      const dl = new ModelDownloader()
      const events: DownloadEvent[] = []
      dl.onProgress((event) => events.push(event))
      await expect(dl.download('fixture')).rejects.toThrow(/SHA256 mismatch/)
      expect(events.some((event) => event.phase === 'complete')).toBe(false)
      expect(events.at(-1)?.phase).toBe('error')
      expect(readFileSync(join(tmpDir, 'fixture.bin'))).toEqual(Buffer.alloc(PAYLOAD.length, 17))
      expect(checkOne(manifest.getManifestEntry('fixture')!).present).toBe(false)
      expect(existsSync(join(tmpDir, 'fixture.bin.partial'))).toBe(false)
      expect(dl.hasAnyActive()).toBe(false)
    })
  })

  it('repairs the existing wizard file without creating a shadowed userData copy', async () => {
    const wizard = join(tmpDir, 'wizard')
    mkdirSync(wizard)
    const target = join(wizard, 'fixture.bin')
    const original = Buffer.alloc(PAYLOAD.length, 17)
    writeFileSync(target, original)
    vi.mocked(paths.resolveModelFile).mockReturnValue(target)
    await withFixtureManifest(`${baseUrl}/ok`, { sha256: PAYLOAD_SHA }, async () => {
      const entry = manifest.getManifestEntry('fixture')!
      // Tier-only IDs must use the same catalog for status and downloads.
      vi.spyOn(installedManifest, 'getDownloadManifestEntry').mockReturnValue({
        ...entry,
        id: 'tier-only',
      })
      const dl = new ModelDownloader()
      const observedOriginals: Buffer[] = []
      dl.onProgress((event) => {
        if (event.phase === 'downloading') observedOriginals.push(readFileSync(target))
      })
      await dl.download('tier-only')
      expect(observedOriginals.length).toBeGreaterThan(0)
      expect(observedOriginals.every((bytes) => bytes.equals(original))).toBe(true)
      expect(readFileSync(target)).toEqual(PAYLOAD)
      expect(existsSync(join(tmpDir, 'fixture.bin'))).toBe(false)
      expect(checkOne(entry).present).toBe(true)
      expect(existsSync(`${target}.loklm-invalid.json`)).toBe(false)
    })
  })

  it('preserves a corrupt original on cancellation and permits a verified retry', async () => {
    const target = join(tmpDir, 'fixture.bin')
    const original = Buffer.alloc(PAYLOAD.length, 17)
    writeFileSync(target, original)
    await withFixtureManifest(`${baseUrl}/ok`, { sha256: PAYLOAD_SHA }, async () => {
      const dl = new ModelDownloader()
      const events: DownloadEvent[] = []
      const off = dl.onProgress((event) => {
        events.push(event)
        if (event.phase === 'downloading') dl.cancel(event.id)
      })
      await dl.download('fixture')
      expect(events.at(-1)?.phase).toBe('cancelled')
      expect(events.some((event) => event.phase === 'complete')).toBe(false)
      expect(readFileSync(target)).toEqual(original)
      expect(checkOne(manifest.getManifestEntry('fixture')!).present).toBe(false)
      expect(dl.hasAnyActive()).toBe(false)
      off()
      await dl.download('fixture')
      expect(readFileSync(target)).toEqual(PAYLOAD)
      expect(checkOne(manifest.getManifestEntry('fixture')!).present).toBe(true)
    })
  })

  it('leaves original bytes intact if verified replacement cannot be installed', async () => {
    const target = join(tmpDir, 'fixture.bin')
    const original = Buffer.alloc(PAYLOAD.length, 17)
    writeFileSync(target, original)
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
    vi.mocked(fs.renameSync).mockImplementation((source, destination) => {
      if (source === `${target}.partial`) throw new Error('EACCES: cannot replace model')
      actual.renameSync(source, destination)
    })
    await withFixtureManifest(`${baseUrl}/ok`, { sha256: PAYLOAD_SHA }, async () => {
      const dl = new ModelDownloader()
      const events: DownloadEvent[] = []
      dl.onProgress((event) => events.push(event))
      await expect(dl.download('fixture')).rejects.toThrow(/EACCES/)
      expect(readFileSync(target)).toEqual(original)
      expect(readFileSync(`${target}.partial`)).toEqual(PAYLOAD)
      expect(checkOne(manifest.getManifestEntry('fixture')!).present).toBe(false)
      expect(events.at(-1)?.phase).toBe('error')
      expect(dl.hasAnyActive()).toBe(false)
    })
  })

  it('does not overwrite a file the user replaces during a repair', async () => {
    const target = join(tmpDir, 'fixture.bin')
    const manual = Buffer.from('manually replaced model')
    writeFileSync(target, Buffer.alloc(PAYLOAD.length, 17))
    await withFixtureManifest(`${baseUrl}/ok`, { sha256: PAYLOAD_SHA }, async () => {
      const dl = new ModelDownloader()
      dl.onProgress((event) => {
        if (event.phase === 'downloading') writeFileSync(target, manual)
      })
      await expect(dl.download('fixture')).rejects.toThrow(/changed during download/)
      expect(readFileSync(target)).toEqual(manual)
      expect(dl.hasAnyActive()).toBe(false)
    })
  })

  it('reports an unwritable repair directory without deleting the original or starting a fetch', async () => {
    const target = join(tmpDir, 'fixture.bin')
    const original = Buffer.alloc(PAYLOAD.length, 17)
    writeFileSync(target, original)
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
    vi.mocked(fs.writeFileSync).mockImplementation((path, data, options) => {
      if (String(path).includes('.loklm-invalid.json.'))
        throw new Error('EACCES: read-only location')
      actual.writeFileSync(path, data, options)
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await withFixtureManifest(`${baseUrl}/ok`, { sha256: PAYLOAD_SHA }, async () => {
      const dl = new ModelDownloader()
      await expect(dl.download('fixture')).rejects.toThrow(/directory write permissions/)
      expect(readFileSync(target)).toEqual(original)
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(checkOne(manifest.getManifestEntry('fixture')!).present).toBe(false)
      expect(dl.hasAnyActive()).toBe(false)
    })
  })

  it('does not treat a directory with a model filename as an installed model', async () => {
    mkdirSync(join(tmpDir, 'fixture.bin'))
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await withFixtureManifest(`${baseUrl}/ok`, { sizeBytes: 0 }, async () => {
      const dl = new ModelDownloader()
      await expect(dl.download('fixture')).rejects.toThrow(/not a regular file/)
      expect(statSync(join(tmpDir, 'fixture.bin')).isDirectory()).toBe(true)
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(dl.hasAnyActive()).toBe(false)
    })
  })

  it('retains original bytes and failed validation when the repair server is unavailable', async () => {
    const target = join(tmpDir, 'fixture.bin')
    const original = Buffer.alloc(PAYLOAD.length, 17)
    writeFileSync(target, original)
    await withFixtureManifest(`${baseUrl}/unavailable`, { sha256: PAYLOAD_SHA }, async () => {
      const dl = new ModelDownloader()
      await expect(dl.download('fixture')).rejects.toThrow(/HTTP 503/)
      expect(readFileSync(target)).toEqual(original)
      expect(checkOne(manifest.getManifestEntry('fixture')!).present).toBe(false)
      expect(dl.hasAnyActive()).toBe(false)
    })
  })

  it('does not report completion if stale invalid status cannot be cleared', async () => {
    const target = join(tmpDir, 'fixture.bin')
    writeFileSync(target, PAYLOAD)
    mkdirSync(`${target}.loklm-invalid.json`)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await withFixtureManifest(`${baseUrl}/ok`, { sha256: PAYLOAD_SHA }, async () => {
      const dl = new ModelDownloader()
      const events: DownloadEvent[] = []
      dl.onProgress((event) => events.push(event))
      await expect(dl.download('fixture')).rejects.toThrow(/Cannot clear model repair status/)
      expect(events.at(-1)?.phase).toBe('error')
      expect(events.some((event) => event.phase === 'complete')).toBe(false)
      expect(readFileSync(target)).toEqual(PAYLOAD)
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(dl.hasAnyActive()).toBe(false)
    })
  })

  it('cancels a downloaded file during verification before publishing it', async () => {
    await withFixtureManifest(`${baseUrl}/ok`, { sha256: PAYLOAD_SHA }, async () => {
      const dl = new ModelDownloader()
      const events: DownloadEvent[] = []
      const off = dl.onProgress((event) => {
        events.push(event)
        if (event.phase === 'verifying') dl.cancel(event.id)
      })
      await dl.download('fixture')
      expect(events.at(-1)?.phase).toBe('cancelled')
      expect(events.some((event) => event.phase === 'complete')).toBe(false)
      expect(existsSync(join(tmpDir, 'fixture.bin'))).toBe(false)
      expect(readFileSync(join(tmpDir, 'fixture.bin.partial')).equals(PAYLOAD)).toBe(true)
      expect(dl.hasAnyActive()).toBe(false)
      off()
      await dl.download('fixture')
      expect(readFileSync(join(tmpDir, 'fixture.bin')).equals(PAYLOAD)).toBe(true)
    })
  })

  it('writes the payload, verifies SHA256, and reports complete', async () => {
    await withFixtureManifest(`${baseUrl}/ok`, { sha256: PAYLOAD_SHA }, async () => {
      const dl = new ModelDownloader()
      const events = await collect(dl, () => dl.download('fixture'))
      const out = join(tmpDir, 'fixture.bin')
      expect(existsSync(out)).toBe(true)
      expect(readFileSync(out).equals(PAYLOAD)).toBe(true)
      const phases = events.map((e) => e.phase)
      expect(phases).toContain('downloading')
      expect(phases).toContain('verifying')
      expect(phases[phases.length - 1]).toBe('complete')
    })
  })

  it('rejects and deletes the partial on SHA mismatch', async () => {
    const wrong = 'a'.repeat(64)
    await withFixtureManifest(`${baseUrl}/ok`, { sha256: wrong }, async () => {
      const dl = new ModelDownloader()
      const events: DownloadEvent[] = []
      dl.onProgress((ev) => events.push(ev))
      await expect(dl.download('fixture')).rejects.toThrow(/SHA256 mismatch/)
      expect(existsSync(join(tmpDir, 'fixture.bin'))).toBe(false)
      expect(existsSync(join(tmpDir, 'fixture.bin.partial'))).toBe(false)
      expect(events[events.length - 1]?.phase).toBe('error')
    })
  })

  it('falls back to size-only verify when no sha is set', async () => {
    await withFixtureManifest(`${baseUrl}/ok`, {}, async () => {
      const dl = new ModelDownloader()
      await dl.download('fixture')
      expect(statSync(join(tmpDir, 'fixture.bin')).size).toBe(PAYLOAD.length)
    })
  })

  it('size verify rejects when manifest size is far off', async () => {
    // Set the manifest size to something the payload can't match (within ±2%).
    await withFixtureManifest(`${baseUrl}/ok`, { sizeBytes: PAYLOAD.length * 10 }, async () => {
      const dl = new ModelDownloader()
      await expect(dl.download('fixture')).rejects.toThrow(/Size check failed/)
      expect(existsSync(join(tmpDir, 'fixture.bin'))).toBe(false)
    })
  })

  it('resumes from an existing .partial when the server honors Range', async () => {
    const half = PAYLOAD.length >> 1
    writeFileSync(join(tmpDir, 'fixture.bin.partial'), PAYLOAD.subarray(0, half))
    await withFixtureManifest(`${baseUrl}/ok`, {}, async () => {
      const dl = new ModelDownloader()
      const events: DownloadEvent[] = []
      dl.onProgress((ev) => events.push(ev))
      await dl.download('fixture')
      expect(readFileSync(join(tmpDir, 'fixture.bin')).equals(PAYLOAD)).toBe(true)
      // First downloading event should already report `half` bytes received.
      const firstDl = events.find((e) => e.phase === 'downloading')
      expect(firstDl?.bytesReceived).toBe(half)
    })
  })

  it('discards the partial and starts fresh when server ignores Range', async () => {
    const half = PAYLOAD.length >> 1
    writeFileSync(join(tmpDir, 'fixture.bin.partial'), PAYLOAD.subarray(0, half))
    await withFixtureManifest(`${baseUrl}/no-range`, {}, async () => {
      const dl = new ModelDownloader()
      await dl.download('fixture')
      expect(readFileSync(join(tmpDir, 'fixture.bin')).equals(PAYLOAD)).toBe(true)
    })
  })

  it('rejects cleanly when the partial file cannot be written', async () => {
    // Simulate a write failure (disk full / permission / EISDIR) by making the
    // .partial path an existing directory so the write stream's open errors.
    // Without an 'error' handler on the stream, this surfaces as an unhandled
    // exception (crash) or a hung download instead of a clean rejection.
    mkdirSync(join(tmpDir, 'fixture.bin.partial'))
    await withFixtureManifest(`${baseUrl}/ok`, {}, async () => {
      const dl = new ModelDownloader()
      const events: DownloadEvent[] = []
      dl.onProgress((ev) => events.push(ev))
      await expect(dl.download('fixture')).rejects.toThrow()
      expect(events[events.length - 1]?.phase).toBe('error')
    })
  })

  it('cancel() leaves the partial in place for a future resume', async () => {
    await withFixtureManifest(`${baseUrl}/slow`, {}, async () => {
      const dl = new ModelDownloader()
      const events: DownloadEvent[] = []
      dl.onProgress((ev) => events.push(ev))
      const inflight = dl.download('fixture')
      // Let some bytes through before cancelling.
      await new Promise((r) => setTimeout(r, 5))
      dl.cancel('fixture')
      await inflight
      expect(existsSync(join(tmpDir, 'fixture.bin'))).toBe(false)
      // Last event should be cancelled.
      expect(events[events.length - 1]?.phase).toBe('cancelled')
    })
  })
})
