import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir, unlink, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthService } from '@main/services/auth/AuthService'
import { WorkspaceService } from '@main/services/documents/WorkspaceService'
import { DocumentService } from '@main/services/documents/DocumentService'
import { FolderSyncService } from '@main/services/documents/FolderSyncService'

// Folder-sync exercises the path-tracking model end-to-end without any
// embedder/GGUF: import = new doc row, refresh = hash-aware reindex, missing-
// under-watched-root = soft-marker for the banner (NOT auto-delete). The
// DocumentService here is built without a registry (Spec 1 behaviour) so
// chunks land with NULL embeddings — that's fine, the assertions read
// `chunk_count` from the triggers, not vectors.

async function waitFor(cond: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await cond()) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('waitFor timed out')
}

describe('FolderSyncService (integration)', () => {
  let vaultDir: string
  let folderA: string
  let folderB: string
  let auth: AuthService

  beforeEach(async () => {
    vaultDir = await mkdtemp(join(tmpdir(), 'loklm-sync-vault-'))
    folderA = await mkdtemp(join(tmpdir(), 'loklm-sync-a-'))
    folderB = await mkdtemp(join(tmpdir(), 'loklm-sync-b-'))
    auth = new AuthService(vaultDir)
    await auth.register({ displayName: 'Tst', password: 'Test12345!', recoveryLang: 'en' })
  })

  afterEach(async () => {
    await auth.lock().catch(() => undefined)
    await rm(vaultDir, { recursive: true, force: true })
    await rm(folderA, { recursive: true, force: true })
    await rm(folderB, { recursive: true, force: true })
  })

  it('multiple folders per workspace + new/changed/removed reconciliation', async () => {
    const ws = await new WorkspaceService(auth).create('WS')
    const docs = new DocumentService(auth)
    const sync = new FolderSyncService(auth, docs)

    // Pre-seed two files under two different folders, then attach both as
    // sync folders. addFolder doesn't auto-sync (the IPC handler does); we
    // call sync() explicitly so the test is deterministic.
    const fileA = join(folderA, 'alpha.md')
    const fileB = join(folderB, 'bravo.md')
    await writeFile(fileA, '# Alpha\n\nfirst.', 'utf-8')
    await writeFile(fileB, '# Bravo\n\nsecond.', 'utf-8')

    await sync.addFolder(ws.id, folderA)
    await sync.addFolder(ws.id, folderB)
    expect(await sync.getFolders(ws.id)).toEqual([folderA, folderB])

    // Initial sync: both files imported.
    let r = await sync.sync(ws.id)
    expect(r.imported).toBe(2)
    expect(r.reindexed).toBe(0)
    expect(r.markedMissing).toBe(0)

    // Wait for indexing to settle so chunk_count is non-zero.
    await waitFor(async () => {
      const list = await auth.requireDatabase().documents().listDocumentsByWorkspace(ws.id)
      return list.length === 2 && list.every((d) => d.status === 'ready')
    }, 10_000)

    // Run sync again — no changes on disk, so everything is 'unchanged'.
    r = await sync.sync(ws.id)
    expect(r.imported).toBe(0)
    expect(r.reindexed).toBe(0)
    expect(r.unchanged).toBe(2)

    // Modify alpha.md — bump bytes AND mtime so the cheap mtime check fires.
    await writeFile(fileA, '# Alpha\n\nfirst.\n\nappended.', 'utf-8')
    const future = new Date(Date.now() + 2_000)
    await utimes(fileA, future, future)
    r = await sync.sync(ws.id)
    expect(r.reindexed).toBe(1)
    expect(r.unchanged).toBe(1)

    // Delete bravo.md — sync should soft-mark the row (not delete) so the
    // banner can surface it. The doc still exists ; only the missing marker
    // is set.
    await unlink(fileB)
    r = await sync.sync(ws.id)
    expect(r.markedMissing).toBe(1)
    const afterDelete = await auth.requireDatabase().documents().listDocumentsByWorkspace(ws.id)
    expect(afterDelete).toHaveLength(2)
    const bravoRow = afterDelete.find((d) => d.sourcePath === fileB)!
    expect(bravoRow.missingAt).not.toBeNull()

    // Second sync — bravo still missing, but not the first time, so it's in
    // stillMissing, not markedMissing.
    r = await sync.sync(ws.id)
    expect(r.markedMissing).toBe(0)
    expect(r.stillMissing).toBe(1)

    // Add a new file under folderA — picked up on next sync.
    const fileC = join(folderA, 'charlie.md')
    await writeFile(fileC, '# Charlie\n\nthird.', 'utf-8')
    r = await sync.sync(ws.id)
    expect(r.imported).toBe(1)

    sync.stopAll()
  }, 30_000)

  it('missing marker is lifted when the file reappears', async () => {
    const ws = await new WorkspaceService(auth).create('WS')
    const docs = new DocumentService(auth)
    const sync = new FolderSyncService(auth, docs)

    const path = join(folderA, 'flicker.md')
    await writeFile(path, '# Flicker', 'utf-8')
    await sync.addFolder(ws.id, folderA)
    await sync.sync(ws.id)
    await waitFor(async () => {
      const list = await auth.requireDatabase().documents().listDocumentsByWorkspace(ws.id)
      return list.length === 1 && list[0]!.status === 'ready'
    }, 10_000)

    // Vanish → marker set, banner would surface it.
    await unlink(path)
    await sync.sync(ws.id)
    let unack = await auth.requireDatabase().documents().listMissingUnacknowledged(ws.id)
    expect(unack).toHaveLength(1)

    // Reappear → marker cleared, banner is empty again.
    await writeFile(path, '# Flicker', 'utf-8')
    await sync.sync(ws.id)
    unack = await auth.requireDatabase().documents().listMissingUnacknowledged(ws.id)
    expect(unack).toHaveLength(0)

    sync.stopAll()
  }, 20_000)

  it('dismissed missing docs stay out of the banner until they vanish again', async () => {
    const ws = await new WorkspaceService(auth).create('WS')
    const docs = new DocumentService(auth)
    const sync = new FolderSyncService(auth, docs)
    const repo = auth.requireDatabase().documents()

    const path = join(folderA, 'dismissed.md')
    await writeFile(path, '# Dismissed', 'utf-8')
    await sync.addFolder(ws.id, folderA)
    await sync.sync(ws.id)
    const [doc] = await repo.listDocumentsByWorkspace(ws.id)

    await unlink(path)
    await sync.sync(ws.id)
    expect(await repo.listMissingUnacknowledged(ws.id)).toHaveLength(1)

    // User clicks "Behalten" — stamp dismissed_at. Banner drops the row.
    await repo.dismissMissing(doc!.id)
    expect(await repo.listMissingUnacknowledged(ws.id)).toHaveLength(0)

    // Another sync run while still missing — banner stays quiet (dismissed
    // applies for the current missing-at stamp).
    await sync.sync(ws.id)
    expect(await repo.listMissingUnacknowledged(ws.id)).toHaveLength(0)

    sync.stopAll()
  }, 20_000)

  it('refreshDocument is hash-aware — same bytes after mtime touch stays unchanged', async () => {
    const ws = await new WorkspaceService(auth).create('WS')
    const docs = new DocumentService(auth)

    const path = join(folderA, 'hash.md')
    await writeFile(path, '# Hash\n\nstable bytes.', 'utf-8')
    const imported = await docs.importFile({ workspaceId: ws.id, sourcePath: path })
    await waitFor(async () => {
      const d = await auth.requireDatabase().documents().getDocument(imported.id)
      return d?.status === 'ready'
    }, 10_000)

    // Touch the mtime to a different value but keep bytes identical — refresh
    // should hash, find no change, and return 'unchanged' without reindexing.
    const future = new Date(Date.now() + 5_000)
    await utimes(path, future, future)
    const outcome = await docs.refreshDocument(imported.id)
    expect(outcome).toBe('unchanged')
  }, 20_000)

  it('refreshDocument returns "missing" and stamps the soft-marker', async () => {
    const ws = await new WorkspaceService(auth).create('WS')
    const docs = new DocumentService(auth)
    const path = join(folderA, 'gone.md')
    await writeFile(path, '# Gone', 'utf-8')
    const imported = await docs.importFile({ workspaceId: ws.id, sourcePath: path })
    await waitFor(async () => {
      const d = await auth.requireDatabase().documents().getDocument(imported.id)
      return d?.status === 'ready'
    }, 10_000)

    await unlink(path)
    expect(await docs.refreshDocument(imported.id)).toBe('missing')
    // Doc row stays — the "missing" outcome is informational, not destructive.
    // The marker is set so the banner can surface this doc.
    const still = await auth.requireDatabase().documents().getDocument(imported.id)
    expect(still).toBeDefined()
    expect(still!.missingAt).not.toBeNull()
  }, 20_000)

  it('docs outside any watched folder are NOT marked when their source vanishes', async () => {
    const ws = await new WorkspaceService(auth).create('WS')
    const docs = new DocumentService(auth)
    const sync = new FolderSyncService(auth, docs)
    const repo = auth.requireDatabase().documents()

    // Imported via the one-off path (not under any watched root).
    const orphanDir = await mkdtemp(join(tmpdir(), 'loklm-orphan-'))
    const orphan = join(orphanDir, 'orphan.md')
    await writeFile(orphan, '# Orphan', 'utf-8')
    const imp = await docs.importFile({ workspaceId: ws.id, sourcePath: orphan })

    // Watched folder is empty. Even after deleting the orphan file, sync
    // should not touch its doc row — it wasn't under a watched root.
    await sync.addFolder(ws.id, folderA)
    await unlink(orphan)
    await rm(orphanDir, { recursive: true, force: true })

    const r = await sync.sync(ws.id)
    expect(r.markedMissing).toBe(0)
    const still = await repo.getDocument(imp.id)
    expect(still).toBeDefined()
    expect(still!.missingAt).toBeNull()

    sync.stopAll()
  }, 20_000)

  it('addFolder / removeFolder persists across reads', async () => {
    const ws = await new WorkspaceService(auth).create('WS')
    const docs = new DocumentService(auth)
    const sync = new FolderSyncService(auth, docs)

    await sync.addFolder(ws.id, folderA)
    await sync.addFolder(ws.id, folderB)
    expect(await sync.getFolders(ws.id)).toEqual([folderA, folderB])

    await sync.removeFolder(ws.id, folderA)
    expect(await sync.getFolders(ws.id)).toEqual([folderB])

    // Duplicate-add is a no-op.
    await sync.addFolder(ws.id, folderB)
    expect(await sync.getFolders(ws.id)).toEqual([folderB])

    sync.stopAll()
  }, 20_000)

  it('walks nested directories and skips dotfiles + node_modules', async () => {
    const ws = await new WorkspaceService(auth).create('WS')
    const docs = new DocumentService(auth)
    const sync = new FolderSyncService(auth, docs)

    await writeFile(join(folderA, 'top.md'), '# top', 'utf-8')
    await mkdir(join(folderA, 'nested'))
    await writeFile(join(folderA, 'nested', 'deep.md'), '# deep', 'utf-8')
    await mkdir(join(folderA, '.hidden'))
    await writeFile(join(folderA, '.hidden', 'secret.md'), '# secret', 'utf-8')
    await mkdir(join(folderA, 'node_modules'))
    await writeFile(join(folderA, 'node_modules', 'pkg.md'), '# pkg', 'utf-8')

    await sync.addFolder(ws.id, folderA)
    const r = await sync.sync(ws.id)
    expect(r.imported).toBe(2) // top.md + nested/deep.md

    const paths = (await auth.requireDatabase().documents().listDocumentsByWorkspace(ws.id))
      .map((d) => d.sourcePath)
      .sort()
    expect(paths).toEqual([join(folderA, 'nested', 'deep.md'), join(folderA, 'top.md')])

    sync.stopAll()
  }, 20_000)
})
