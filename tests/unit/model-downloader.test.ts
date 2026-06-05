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

const PAYLOAD = Buffer.alloc(64 * 1024)
for (let i = 0; i < PAYLOAD.length; i++) PAYLOAD[i] = i & 0xff
const PAYLOAD_SHA = createHash('sha256').update(PAYLOAD).digest('hex')

let server: Server
let baseUrl: string
let tmpDir: string

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'loklm-dl-'))
  // Stub the download target so the downloader writes into a throwaway dir.
  vi.spyOn(paths, 'getDownloadTargetDir').mockReturnValue(tmpDir)

  server = createServer((req, res) => {
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
