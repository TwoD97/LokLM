import { describe, expect, it, vi } from 'vitest'
import { assessRerankerPolicy } from '../../src/shared/modelCapabilities'
import type { ModelsWorkerClient } from '@main/services/workers/ModelsWorkerClient'
import type { RerankerStatus } from '../../src/shared/documents'

vi.mock('@main/services/models/paths', () => ({
  getModelSearchDirs: () => ['/models'],
  resolveModelFile: () => '/models/test-reranker.gguf',
}))

import { RerankerService } from '@main/services/retrieval/RerankerService'

const defaultPolicy = { enabled: true, mode: 'auto' as const, source: 'bundled' as const }
const smallGpu = { hasGpu: true, totalVramGB: 4, totalRamGB: 64, freeVramGB: 3 }

function service(resources: typeof smallGpu | null = smallGpu) {
  let listener: (status: Partial<RerankerStatus>) => void = () => {}
  const client = {
    setStatusListener: (_kind: string, cb: typeof listener) => {
      listener = cb
    },
    refreshResources:
      resources === null
        ? vi.fn().mockRejectedValue(new Error('GPU detection failed'))
        : vi.fn().mockResolvedValue(resources),
    rerankerLoad: vi.fn().mockImplementation(async () => {
      listener({ state: 'ready', resident: true })
      return { resolvedPlacement: 'gpu', reason: 'test GPU', resources }
    }),
    rerankerUnload: vi.fn().mockImplementation(async () => {
      listener({ state: 'unloaded', resident: false })
    }),
    rerankerRank: vi.fn().mockResolvedValue([0.9]),
  }
  return {
    client,
    service: new RerankerService({ client: client as unknown as ModelsWorkerClient }),
  }
}

describe('reranker memory policy', () => {
  it('publishes localizable policy decisions and avoids repeated identical pushes', async () => {
    const { service: reranker } = service()
    const pushes = vi.fn()
    reranker.subscribe(pushes)
    await reranker.setPolicy(defaultPolicy)
    expect(reranker.getStatus().policyDecision?.reason).toBe('low-vram')
    expect(pushes).toHaveBeenCalledWith(
      expect.objectContaining({ policyDecision: expect.objectContaining({ reason: 'low-vram' }) }),
    )
    pushes.mockClear()
    await reranker.refreshPolicy()
    expect(pushes).not.toHaveBeenCalled()
    await reranker.setPolicy({ ...defaultPolicy, mode: 'always' })
    expect(reranker.getStatus().policyDecision?.reason).toBe('manual')
  })
  it('skips a 4 GiB local GPU regardless of abundant system RAM or free VRAM', () => {
    expect(assessRerankerPolicy({ ...defaultPolicy, resources: smallGpu })).toMatchObject({
      allowed: false,
      reason: 'low-vram',
      totalVramGB: 4,
    })
    expect(
      assessRerankerPolicy({ ...defaultPolicy, resources: { ...smallGpu, totalVramGB: 4.1 } }),
    ).toMatchObject({
      allowed: false,
      reason: 'low-vram',
    })
    const largerBusyGpu = { ...smallGpu, totalVramGB: 8, freeVramGB: 0.2 }
    expect(assessRerankerPolicy({ ...defaultPolicy, resources: largerBusyGpu })).toMatchObject({
      allowed: true,
      reason: 'auto',
      totalVramGB: 8,
    })
  })

  it('permits explicit GPU swapping but never silently chooses CPU-only inference', () => {
    expect(
      assessRerankerPolicy({ ...defaultPolicy, mode: 'always', resources: smallGpu }).allowed,
    ).toBe(true)
    expect(
      assessRerankerPolicy({
        ...defaultPolicy,
        mode: 'always',
        resources: { ...smallGpu, hasGpu: false },
      }),
    ).toMatchObject({
      allowed: false,
      reason: 'gpu-unavailable',
    })
  })

  it('keeps unknown or invalid GPU memory off, and does not judge an external provider by local VRAM', () => {
    for (const resources of [
      null,
      { hasGpu: true, totalVramGB: 0 },
      { hasGpu: true, totalVramGB: Number.NaN },
    ]) {
      expect(assessRerankerPolicy({ ...defaultPolicy, resources })).toMatchObject({
        allowed: false,
        reason: 'unknown-vram',
      })
    }
    expect(
      assessRerankerPolicy({ ...defaultPolicy, source: 'ollama', resources: null }),
    ).toMatchObject({ allowed: true, reason: 'external' })
    expect(
      assessRerankerPolicy({ ...defaultPolicy, enabled: false, source: 'ollama', resources: null }),
    ).toMatchObject({ allowed: false, reason: 'disabled' })
  })

  it('prevents startup, explicit reload and on-demand ranking from loading the model on 4 GiB', async () => {
    const { service: reranker, client } = service()
    expect(await reranker.ensureReady()).toBe(false)
    await reranker.loadModel('/models/test-reranker.gguf')
    expect(await reranker.rank('question', ['passage'])).toBeNull()
    expect(client.rerankerLoad).not.toHaveBeenCalled()
    expect(client.rerankerRank).not.toHaveBeenCalled()
    expect(reranker.isReady()).toBe(false)
    expect(reranker.info()).toMatchObject({
      state: 'unloaded',
      resident: false,
      policyDecision: { reason: 'low-vram' },
    })
  })

  it('loads on a larger GPU, then unloads when the policy disables the local feature', async () => {
    const { service: reranker, client } = service({ ...smallGpu, totalVramGB: 8 })
    expect(await reranker.ensureReady()).toBe(true)
    expect(await reranker.rank('question', ['passage'])).toEqual([0.9])
    expect(client.rerankerLoad).toHaveBeenCalledOnce()
    await reranker.setPolicy({ ...defaultPolicy, enabled: false })
    expect(client.rerankerUnload).toHaveBeenCalledOnce()
    expect(reranker.isReady()).toBe(false)
    expect(reranker.info().policyDecision?.reason).toBe('disabled')
  })

  it('supports opt-in on 4 GiB, but does no local work when the external source is selected', async () => {
    const { service: reranker, client } = service()
    await reranker.setPolicy({ ...defaultPolicy, mode: 'always' })
    expect(await reranker.ensureReady()).toBe(true)
    expect(client.rerankerLoad).toHaveBeenCalledWith(expect.objectContaining({ policy: 'always' }))
    await reranker.setPolicy({ ...defaultPolicy, source: 'ollama' })
    client.refreshResources.mockClear()
    expect(await reranker.ensureReady()).toBe(false)
    expect(client.refreshResources).not.toHaveBeenCalled()
    expect(reranker.info().policyDecision).toMatchObject({ allowed: true, reason: 'external' })
  })

  it('reports a failed GPU probe as unknown without trying a native load', async () => {
    const { service: reranker, client } = service(null)
    expect(await reranker.ensureReady()).toBe(false)
    expect(client.rerankerLoad).not.toHaveBeenCalled()
    expect(reranker.info().policyDecision).toMatchObject({ allowed: false, reason: 'unknown-vram' })
  })

  it('does not advertise a native load as ready after the user turns reranking off', async () => {
    const { service: reranker, client } = service({ ...smallGpu, totalVramGB: 8 })
    const completeLoad = client.rerankerLoad.getMockImplementation()!
    let finish!: () => void
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    client.rerankerLoad.mockImplementation(async () => {
      await pending
      return completeLoad()
    })
    const loading = reranker.ensureReady()
    await vi.waitFor(() => expect(client.rerankerLoad).toHaveBeenCalledOnce())
    const disabling = reranker.setPolicy({ ...defaultPolicy, enabled: false })
    finish()
    expect(await loading).toBe(false)
    await disabling
    expect(client.rerankerUnload).toHaveBeenCalledOnce()
    expect(reranker.getStatus()).toMatchObject({ state: 'unloaded', resident: false })
  })
})
