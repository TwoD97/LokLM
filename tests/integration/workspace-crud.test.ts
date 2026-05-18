import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthService } from '@main/services/auth/AuthService'
import { WorkspaceService } from '@main/services/documents/WorkspaceService'

describe('WorkspaceService (integration via AuthService)', () => {
  let dir: string
  let auth: AuthService
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'loklm-ws-'))
    auth = new AuthService(dir)
    await auth.register({ displayName: 'Tst', password: 'Test12345!', recoveryLang: 'en' })
  })
  afterEach(async () => {
    await auth.lock().catch(() => undefined)
    await rm(dir, { recursive: true, force: true })
  })

  it('create → list → rename → delete', async () => {
    const ws = new WorkspaceService(auth)
    const a = await ws.create('Alpha')
    const b = await ws.create('Bravo')
    expect((await ws.list()).map((w) => w.name).sort()).toEqual(['Alpha', 'Bravo'])
    await ws.rename(a.id, 'Alpha-Renamed')
    expect((await ws.list()).find((w) => w.id === a.id)?.name).toBe('Alpha-Renamed')
    await ws.delete(b.id)
    expect((await ws.list()).map((w) => w.name)).toEqual(['Alpha-Renamed'])
  }, 30_000)

  it('rejects empty / overly long names', async () => {
    const ws = new WorkspaceService(auth)
    await expect(ws.create('')).rejects.toThrow(/name/i)
    await expect(ws.create('x'.repeat(129))).rejects.toThrow(/name/i)
  })
})
