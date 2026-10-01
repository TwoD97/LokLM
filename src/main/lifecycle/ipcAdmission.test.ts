import { describe, expect, it, vi } from 'vitest'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { withPrivateIpcAdmission } from './ipcAdmission'

function fixture() {
  let closing = false
  let unlocked = true
  let epoch = 0
  const handlers = new Map<string, Parameters<IpcMain['handle']>[1]>()
  const guarded = withPrivateIpcAdmission(
    { handle: (channel, handler) => handlers.set(channel, handler) },
    () => {
      if (closing || !unlocked) throw new Error('Vault is locked or draining')
    },
    () => {
      const started = epoch
      return () => {
        if (started !== epoch) throw new Error('Session was replaced')
      }
    },
  )
  return {
    guarded,
    beginDrain: () => {
      closing = true
      epoch++
    },
    finishLock: () => {
      unlocked = false
      closing = false
    },
    unlock: () => {
      unlocked = true
      closing = false
    },
    invoke: (channel: string, ...args: unknown[]) =>
      handlers.get(channel)!({} as IpcMainInvokeEvent, ...args),
  }
}

describe('private IPC admission', () => {
  it('rejects private reads and mutations throughout a held drain while admitted work finishes', async () => {
    const f = fixture()
    let finish!: () => void
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    let writeCompleted = false
    const admitted = vi.fn(async () => {
      await pending
      writeCompleted = true
      return 'already admitted'
    })
    const read = vi.fn(() => 'private history')
    const mutate = vi.fn(() => 'deleted')
    f.guarded.handle('documents:import', admitted)
    f.guarded.handle('conversations:getWithMessages', read)
    f.guarded.handle('conversations:deleteMessage', mutate)
    const operation = f.invoke('documents:import')
    f.beginDrain()
    expect(() => f.invoke('conversations:getWithMessages', 1)).toThrow(/draining/)
    expect(() => f.invoke('conversations:deleteMessage', 2)).toThrow(/draining/)
    expect(read).not.toHaveBeenCalled()
    expect(mutate).not.toHaveBeenCalled()
    finish()
    await expect(operation).rejects.toThrow(/draining/)
    expect(writeCompleted).toBe(true)
    f.finishLock()
    expect(() => f.invoke('conversations:getWithMessages', 1)).toThrow(/locked/)
    expect(admitted).toHaveBeenCalledOnce()
  })

  it('does not publish a late read after lock and a different session unlock', async () => {
    const f = fixture()
    let finish!: (value: string) => void
    const pending = new Promise<string>((resolve) => {
      finish = resolve
    })
    f.guarded.handle('conversations:getWithMessages', () => pending)
    const response = f.invoke('conversations:getWithMessages', 1)
    f.beginDrain()
    f.finishLock()
    f.unlock()
    finish('private old-session history')
    await expect(response).rejects.toThrow('Session was replaced')
  })

  it('does not publish a late private error after lock and a different session unlock', async () => {
    const f = fixture()
    let fail!: (error: Error) => void
    const pending = new Promise<never>((_resolve, reject) => {
      fail = reject
    })
    f.guarded.handle('documents:readGeneratedText', () => pending)
    const response = f.invoke('documents:readGeneratedText', 1)
    f.beginDrain()
    f.finishLock()
    f.unlock()
    fail(new Error('Private document path: /synthetic-private/source.txt'))
    await expect(response).rejects.toThrow('Session was replaced')
    await expect(response).rejects.not.toThrow('synthetic-private')
  })

  it('defaults new feature channels and account secrets to private', () => {
    const f = fixture()
    const privateHandler = vi.fn()
    const channels = [
      'future:readPrivateData',
      'settings:getAvatar',
      'settings:setDisplayName',
      'auth:regenerateRecovery',
      'auth:verifyPassword',
      'clipboard:copySecret',
      'ollama:probe',
      'models:warmupForQa',
      'llm:reload',
      'workspaces:create',
    ]
    for (const channel of channels) f.guarded.handle(channel, privateHandler)
    f.beginDrain()
    for (const channel of channels) expect(() => f.invoke(channel)).toThrow(/draining/)
    expect(privateHandler).not.toHaveBeenCalled()
  })

  it('keeps login, lock, window controls, safe status and cancellation available', async () => {
    const f = fixture()
    const publicHandler = vi.fn((_event, value: string) => value)
    const channels = [
      'auth:status',
      'auth:register',
      'auth:login',
      'auth:reset',
      'auth:lock',
      'window:close',
      'window:minimize',
      'settings:get',
      'models:activity',
      'llm:status',
      'embedder:status',
      'reranker:status',
      'chat:cancel',
      'translation:cancel',
      'transcription:cancel',
      'quiz:cancel-generate',
    ]
    for (const channel of channels) f.guarded.handle(channel, publicHandler)
    f.beginDrain()
    for (const channel of channels) expect(f.invoke(channel, channel)).toBe(channel)
    f.finishLock()
    for (const channel of channels) expect(f.invoke(channel, channel)).toBe(channel)
  })
})
