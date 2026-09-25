import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmbeddingService } from '@main/services/embeddings/EmbeddingService'
import type { ModelsWorkerClient } from '@main/services/workers/ModelsWorkerClient'
import type { EmbedderStatus } from '@shared/documents'
import { deferred } from './fixtures/retrievalHarness'

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

function fixture() {
  const folder = mkdtempSync(join(tmpdir(), 'loklm-query-cache-'))
  folders.push(folder)
  const path = join(folder, 'Qwen3-Embedding-0.6B-Q8_0.gguf')
  writeFileSync(path, 'fixture metadata only; no native model is loaded')
  let status!: (patch: Partial<EmbedderStatus>) => void
  const client = {
    setStatusListener: (_kind: string, cb: typeof status) => {
      status = cb
    },
    embedderLoad: vi.fn(async () => {
      status({ state: 'ready', resident: true })
      return { resolvedPlacement: 'gpu', reason: 'test', resources: {} }
    }),
    embedderUnload: vi.fn(async () => {
      status({ state: 'unloaded', resident: false })
    }),
  }
  const service = new EmbeddingService({ client: client as unknown as ModelsWorkerClient })
  return { service, path, client, status: (patch: Partial<EmbedderStatus>) => status(patch) }
}

describe('bundled query cache identity', () => {
  it('uses the exact sanitized query and task instruction without exposing query text', async () => {
    const { service, path } = fixture()
    expect(service.queryCacheKey('SecretQuery')).toBeNull()
    await service.loadModel(path)
    const docKey = service.queryCacheKey('  SecretQuery\n  value ')
    expect(docKey).toMatch(/^[a-f0-9]{64}$/)
    expect(docKey).toBe(service.queryCacheKey('SecretQuery value'))
    expect(docKey).not.toBe(service.queryCacheKey('secretquery value'))
    expect(docKey).not.toBe(service.queryCacheKey('SecretQuery value', { codebase: true }))
    expect(docKey).not.toContain('SecretQuery')
  })

  it('survives worker parking but invalidates explicit unload/reload and file replacement', async () => {
    const { service, path, status } = fixture()
    await service.loadModel(path)
    const initial = service.queryCacheKey('query')
    status({ state: 'unloaded', resident: false })
    expect(service.queryCacheKey('query')).toBeNull()
    status({ state: 'ready', resident: false })
    expect(service.queryCacheKey('query')).toBe(initial)
    await service.unload()
    expect(service.queryCacheKey('query')).toBeNull()
    await service.loadModel(path)
    expect(service.queryCacheKey('query')).not.toBe(initial)
    // An in-place edit while resident must bypass caching until an explicit
    // reload establishes which revision the native model actually contains.
    writeFileSync(path, 'replacement')
    expect(service.queryCacheKey('query')).toBeNull()
  })

  it('bypasses an ambiguous file revision changed while native loading is in flight', async () => {
    const { service, path, client, status } = fixture()
    await service.loadModel(path)
    expect(service.queryCacheKey('query')).not.toBeNull()
    const pending = deferred<Awaited<ReturnType<typeof client.embedderLoad>>>()
    client.embedderLoad.mockReturnValueOnce(pending.promise)
    const loading = service.loadModel(path)
    expect(service.queryCacheKey('query')).toBeNull()
    writeFileSync(path, 'different weights arrived while loading')
    status({ state: 'ready', resident: true })
    pending.resolve({ resolvedPlacement: 'gpu', reason: 'test', resources: {} })
    await loading
    expect(service.queryCacheKey('query')).toBeNull()
  })
})
