import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fork: vi.fn(), once: vi.fn() }))
vi.mock('electron', () => ({ utilityProcess: { fork: mocks.fork }, app: { once: mocks.once } }))
import { ModelsWorkerClient } from '@main/services/workers/ModelsWorkerClient'
beforeEach(() => vi.clearAllMocks())

describe('model worker shutdown', () => {
  it('accepts work after a device restart and invalidates parked model availability', async () => {
    mocks.fork.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & {
        postMessage: (m: { id: number }) => void
        kill: () => void
      }
      child.postMessage = (m) => {
        queueMicrotask(() => child.emit('message', { id: m.id, ok: true, result: [] }))
      }
      child.kill = () => {
        child.emit('exit', 0)
      }
      queueMicrotask(() => child.emit('spawn'))
      return child
    })
    const client = new ModelsWorkerClient()
    const status = vi.fn()
    client.setStatusListener('embedder', status)
    await client.embedderEmbed(['initial'])
    await client.setDevicePlan({
      backend: 'vulkan',
      ggmlVkVisibleDevices: '0',
      cudaVisibleDevices: null,
      expectedName: 'test',
      expectedKind: 'dedicated',
    } as never)
    expect(status).toHaveBeenCalledWith({ state: 'unloaded', resident: false })
    const lease = client.beginIndexing({ workspaceId: 1, title: 'test' })
    await expect(client.embedderEmbed(['next'])).resolves.toEqual([])
    await client.shutdown()
    lease.release()
    expect(mocks.fork).toHaveBeenCalledTimes(2)
  })
  it('does not respawn a worker when an indexing loop submits another batch after shutdown', async () => {
    const child = new EventEmitter() as EventEmitter & {
      postMessage: (m: { id: number; op: string }) => void
      kill: () => void
    }
    const operations: string[] = []
    child.postMessage = (m) => {
      operations.push(m.op)
      queueMicrotask(() => child.emit('message', { id: m.id, ok: true, result: [] }))
    }
    child.kill = () => {
      child.emit('exit', 0)
    }
    mocks.fork.mockImplementation(() => {
      queueMicrotask(() => child.emit('spawn'))
      return child
    })
    const client = new ModelsWorkerClient()
    await client.embedderEmbed(['passage'])
    await client.shutdown()
    await expect(client.embedderEmbed(['remaining passage'])).rejects.toThrow('shutting down')
    expect(mocks.fork).toHaveBeenCalledOnce()
    expect(operations).toEqual(['embedder.embed', 'shutdown'])
  })
})
