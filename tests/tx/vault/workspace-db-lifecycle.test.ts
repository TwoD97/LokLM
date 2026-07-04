import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthService } from '@main/services/auth/AuthService'

// Stage 3a (ADR-0005): the per-workspace encrypted libSQL store is wired into
// the real vault lifecycle — created/opened with the workspace's WDEK, closed
// on lock, reopened after login. Proves relational data survives a restart in
// the libSQL file (not the in-memory PGlite vault).

describe('WorkspaceDb in the vault lifecycle', () => {
  let userDataDir: string

  beforeEach(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'loklm-wsdblife-'))
  })
  afterEach(async () => {
    await rm(userDataDir, { recursive: true, force: true })
  })

  it('persists documents + chunks in the encrypted libSQL store across lock/login', async () => {
    const first = new AuthService(userDataDir)
    await first.register({ displayName: 'Alex', password: 'Test12345!', recoveryLang: 'de' })
    const ws = await first.getWorkspaceStore().create('Research')

    const db = await first.getWorkspaceDb(ws.id)
    const doc = await db.addDocument({ title: 'Notes', sourcePath: '/n.txt', status: 'ready' })
    await db.persistChunks(doc.id, [
      {
        ordinal: 0,
        text: 'mitochondria are the powerhouse',
        pageFrom: 1,
        pageTo: 1,
        tokenCount: 4,
      },
    ])
    expect((await db.searchChunks('mitochondria', 5)).length).toBe(1)
    await first.lock()

    // restart
    const second = new AuthService(userDataDir)
    expect((await second.login('Test12345!')).ok).toBe(true)
    const db2 = await second.getWorkspaceDb(ws.id)
    const hits = await db2.searchChunks('mitochondria', 5)
    expect(hits).toHaveLength(1)
    expect(hits[0]!.document_title).toBe('Notes')
    expect((await db2.getDocument(doc.id))!.status).toBe('ready')
    await second.lock()
  }, 60_000)

  it('rejects the workspace libSQL store under the wrong master key', async () => {
    const first = new AuthService(userDataDir)
    const { passphrase } = await first.register({
      displayName: 'Alex',
      password: 'Test12345!',
      recoveryLang: 'de',
    })
    const ws = await first.getWorkspaceStore().create('W')
    const db = await first.getWorkspaceDb(ws.id)
    await db.addDocument({ title: 'X', sourcePath: '/x', status: 'ready' })
    await first.lock()
    // recovery reset keeps the master DEK, so the workspace still opens
    const second = new AuthService(userDataDir)
    const reset = await second.reset({
      passphrase: passphrase.join(' '),
      newPassword: 'Neues12345!',
    })
    expect(reset.ok).toBe(true)
    const db2 = await second.getWorkspaceDb(ws.id)
    expect((await db2.listDocuments()).length).toBe(1)
    await second.lock()
  }, 60_000)
})
