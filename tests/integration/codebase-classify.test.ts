import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthService } from '@main/services/auth/AuthService'
import { WorkspaceService } from '@main/services/documents/WorkspaceService'
import { DocumentService } from '@main/services/documents/DocumentService'
import { FolderSyncService } from '@main/services/documents/FolderSyncService'

// ADR-0006: syncing a source-project folder auto-classifies the workspace as
// 'codebase'. Exercises FolderSyncService.classifyFolders end-to-end against the
// real per-workspace store (no embedder needed).

describe('codebase classification on folder sync (integration)', () => {
  let vaultDir: string
  let projectDir: string
  let docsDir: string
  let auth: AuthService

  beforeEach(async () => {
    vaultDir = await mkdtemp(join(tmpdir(), 'loklm-cb-vault-'))
    projectDir = await mkdtemp(join(tmpdir(), 'loklm-cb-proj-'))
    docsDir = await mkdtemp(join(tmpdir(), 'loklm-cb-docs-'))
    auth = new AuthService(vaultDir)
    await auth.register({ displayName: 'Tst', password: 'Test12345!', recoveryLang: 'en' })
  })

  afterEach(async () => {
    await auth.lock().catch(() => undefined)
    await rm(vaultDir, { recursive: true, force: true })
    await rm(projectDir, { recursive: true, force: true })
    await rm(docsDir, { recursive: true, force: true })
  })

  it('flips a workspace to codebase when a project folder is classified', async () => {
    const ws = await new WorkspaceService(auth).create('WS')
    await auth.activate(ws.id)
    const sync = new FolderSyncService(auth, new DocumentService(auth))

    // A small Node/TS project: marker file + source under src/, plus a
    // node_modules dir that MUST be ignored by the walk.
    await writeFile(join(projectDir, 'package.json'), '{"name":"demo"}')
    await mkdir(join(projectDir, 'src'), { recursive: true })
    await writeFile(join(projectDir, 'src', 'index.ts'), 'export const a = 1\n')
    await writeFile(join(projectDir, 'src', 'util.ts'), 'export const b = 2\n')
    await writeFile(join(projectDir, 'README.md'), '# Demo\n')
    await mkdir(join(projectDir, 'node_modules', 'dep'), { recursive: true })
    await writeFile(join(projectDir, 'node_modules', 'dep', 'index.js'), 'module.exports = {}\n')

    await sync.addFolder(ws.id, projectDir)
    const classification = await sync.classifyFolders(ws.id)

    expect(classification.isCodebase).toBe(true)
    expect(classification.primaryLanguage).toBe('TypeScript')
    expect(classification.ecosystems).toContain('node')
    // node_modules was pruned — the marker + 2 source files drive the result.
    expect(classification.markers).toContain('package.json')

    const wss = await auth.requireDatabase().workspaces().list()
    expect(wss.find((w) => w.id === ws.id)?.type).toBe('codebase')
  })

  it('leaves a docs-only folder as a library workspace', async () => {
    const ws = await new WorkspaceService(auth).create('Notes')
    await auth.activate(ws.id)
    const sync = new FolderSyncService(auth, new DocumentService(auth))

    await writeFile(join(docsDir, 'a.md'), '# A\n')
    await writeFile(join(docsDir, 'b.md'), '# B\n')
    await writeFile(join(docsDir, 'notes.txt'), 'hello\n')

    await sync.addFolder(ws.id, docsDir)
    const classification = await sync.classifyFolders(ws.id)

    expect(classification.isCodebase).toBe(false)
    const wss = await auth.requireDatabase().workspaces().list()
    expect(wss.find((w) => w.id === ws.id)?.type).toBe('library')
  })
})
