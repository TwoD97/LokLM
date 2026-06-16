import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { WorkspaceStore } from '../../src/main/services/storage/WorkspaceStore'
import { emptyManifest, type VaultManifest } from '../../src/shared/workspaceStorage'

const DIMS = 8
const vec = (): number[] => Array.from({ length: DIMS }, () => Math.random())

function records(
  n: number,
  docId = (i: number): number => i % 3,
): {
  chunkId: number
  documentId: number
  vector: number[]
}[] {
  return Array.from({ length: n }, (_, i) => ({ chunkId: i, documentId: docId(i), vector: vec() }))
}

describe('WorkspaceStore (LanceDB + per-workspace encryption)', () => {
  let baseDir: string
  let masterDek: Buffer
  let manifest: VaultManifest
  let saved: VaultManifest | null

  const makeStore = (dek = masterDek): WorkspaceStore =>
    new WorkspaceStore({
      baseDir,
      masterDek: dek,
      manifest,
      dims: DIMS,
      persistManifest: async (m) => {
        saved = JSON.parse(JSON.stringify(m)) as VaultManifest
      },
    })

  beforeEach(async () => {
    baseDir = await fs.mkdtemp(join(tmpdir(), 'loklm-ws-'))
    masterDek = randomBytes(32)
    manifest = emptyManifest()
    saved = null
  })

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true })
  })

  it('persists vectors encrypted at rest and reads them back across reopen', async () => {
    const store = makeStore()
    const ws = await store.create('Research')
    expect(ws.id).toBe(1)
    expect(saved?.defaultWorkspaceId).toBe(1) // first workspace becomes default

    const vs = await store.open(ws.id)
    const data = records(40)
    await vs.upsert(data)
    expect(await vs.count()).toBe(40)

    // pick a known query: nearest to record 7's own vector should be itself
    const target = data[7]!
    const hit = (await vs.search(target.vector, 1))[0]
    expect(hit?.chunkId).toBe(7)
    expect(hit?.score).toBeGreaterThan(0.99)

    await store.close()

    // at rest: enc/ exists with content, work/ is gone, bytes are not plaintext
    const encDir = join(baseDir, 'ws-1', 'enc')
    const workDir = join(baseDir, 'ws-1', 'work')
    expect(await fs.stat(encDir).then((s) => s.isDirectory())).toBe(true)
    await expect(fs.stat(workDir)).rejects.toThrow() // wiped
    expect(saved?.workspaces[0]?.vectorCount).toBe(40)

    // reopen (fresh store instance, same manifest+key) → data survives decrypt
    manifest = saved!
    const store2 = makeStore()
    const vs2 = await store2.open(1)
    expect(await vs2.count()).toBe(40)
    const hit2 = (await vs2.search(target.vector, 1))[0]
    expect(hit2?.chunkId).toBe(7)
    await store2.close()
  })

  it('rejects opening a workspace with the wrong master key', async () => {
    const store = makeStore()
    const ws = await store.create('Secret')
    const vs = await store.open(ws.id)
    await vs.upsert(records(5))
    await store.close()

    manifest = saved!
    const wrong = makeStore(randomBytes(32))
    await expect(wrong.open(1)).rejects.toThrow(/unwrap/)
  })

  it('supports activeDocumentIds filtering and perDocK capping', async () => {
    const store = makeStore()
    const ws = await store.create('Docs')
    const vs = await store.open(ws.id)
    // 30 chunks across docs 0,1,2 (10 each)
    await vs.upsert(records(30, (i) => i % 3))
    const q = vec()

    const onlyDoc1 = await vs.search(q, 10, { activeDocumentIds: [1] })
    expect(onlyDoc1.length).toBeGreaterThan(0)
    expect(onlyDoc1.every((h) => h.documentId === 1)).toBe(true)

    const capped = await vs.search(q, 30, { perDocK: 2 })
    const perDoc = new Map<number, number>()
    for (const h of capped) perDoc.set(h.documentId, (perDoc.get(h.documentId) ?? 0) + 1)
    expect([...perDoc.values()].every((n) => n <= 2)).toBe(true)
    await store.close()
  })

  it('deletes a workspace and clears the default', async () => {
    const store = makeStore()
    const a = await store.create('A')
    await store.create('B')
    await store.setDefault(a.id)
    expect(saved?.defaultWorkspaceId).toBe(a.id)

    await store.delete(a.id)
    expect(saved?.workspaces.map((w) => w.id)).toEqual([2])
    expect(saved?.defaultWorkspaceId).toBeNull()
    await expect(fs.stat(join(baseDir, 'ws-1'))).rejects.toThrow()
  })

  it('openDefault resolves to the configured default workspace', async () => {
    const store = makeStore()
    await store.create('A')
    const b = await store.create('B')
    await store.setDefault(b.id)
    const vs = await store.openDefault()
    expect(vs).not.toBeNull()
    expect(store.activeWorkspaceId()).toBe(b.id)
    await store.close()
  })
})
