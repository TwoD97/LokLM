import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthService } from '@main/services/auth/AuthService'
import { WorkspaceService } from '@main/services/documents/WorkspaceService'
import { DocumentService } from '@main/services/documents/DocumentService'
import { FolderSyncService } from '@main/services/documents/FolderSyncService'

// ADR-0006 end-to-end (no embedder): a codebase workspace ingests source files
// via the code track (structure-aware chunking) and they become searchable
// through the existing FTS5/BM25 path — identifiers included. Vectors are NULL
// here (no model in tests), exactly like the document pipeline's degraded mode.

async function waitFor(cond: () => Promise<boolean>, timeoutMs = 8000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await cond()) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('waitFor timed out')
}

describe('codebase indexing end-to-end (integration)', () => {
  let vaultDir: string
  let projectDir: string
  let auth: AuthService

  beforeEach(async () => {
    vaultDir = await mkdtemp(join(tmpdir(), 'loklm-cidx-vault-'))
    projectDir = await mkdtemp(join(tmpdir(), 'loklm-cidx-proj-'))
    auth = new AuthService(vaultDir)
    await auth.register({ displayName: 'Tst', password: 'Test12345!', recoveryLang: 'en' })
  })

  afterEach(async () => {
    await auth.lock().catch(() => undefined)
    await rm(vaultDir, { recursive: true, force: true })
    await rm(projectDir, { recursive: true, force: true })
  })

  it('syncs a codebase, chunks code, and finds symbols via FTS', async () => {
    const ws = await new WorkspaceService(auth).create('Proj')
    await auth.activate(ws.id)
    const sync = new FolderSyncService(auth, new DocumentService(auth))

    await writeFile(join(projectDir, 'package.json'), '{"name":"proj"}')
    await mkdir(join(projectDir, 'src'), { recursive: true })
    await writeFile(
      join(projectDir, 'src', 'tax.ts'),
      'export function computeTaxBracket(income: number): number {\n' +
        '  if (income > 100000) return 42\n' +
        '  return 7\n' +
        '}\n',
    )
    await writeFile(join(projectDir, 'README.md'), '# Proj\nProject docs.\n')
    // must be ignored by the code walk:
    await mkdir(join(projectDir, 'node_modules', 'dep'), { recursive: true })
    await writeFile(join(projectDir, 'node_modules', 'dep', 'index.js'), 'module.exports={}\n')

    // register the folder, classify (→ type 'codebase'), then sync.
    await sync.addFolder(ws.id, projectDir)
    const classification = await sync.classifyFolders(ws.id)
    expect(classification.isCodebase).toBe(true)
    await sync.sync(ws.id)

    const db = auth.requireDatabase()
    // wait until the source file is indexed (chunk_count > 0 ⇒ chunks persisted)
    await waitFor(async () => {
      const docs = await db.documents().listDocumentsByWorkspace(ws.id)
      const tax = docs.find((d) => d.sourcePath.endsWith('tax.ts'))
      return !!tax && tax.chunkCount > 0
    })

    const docs = await db.documents().listDocumentsByWorkspace(ws.id)
    const paths = docs.map((d) => d.sourcePath)
    // both tracks landed; node_modules did not
    expect(paths.some((p) => p.endsWith('tax.ts'))).toBe(true)
    expect(paths.some((p) => p.endsWith('README.md'))).toBe(true)
    expect(paths.some((p) => p.includes('node_modules'))).toBe(false)

    // the identifier is findable via FTS/BM25 (no embedder needed)
    const hits = await db.documents().searchChunks(ws.id, 'computeTaxBracket', 5)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]!.text).toContain('computeTaxBracket')

    // and the file surfaces in library search by content
    const lib = await db.documents().searchLibrary(ws.id, 'computeTaxBracket')
    expect(lib.some((r) => r.document_title === 'tax.ts')).toBe(true)
  }, 20_000)

  it('honors .gitignore — ignored dirs and files are not indexed (ADR-0006)', async () => {
    const ws = await new WorkspaceService(auth).create('GI')
    await auth.activate(ws.id)
    const sync = new FolderSyncService(auth, new DocumentService(auth))

    await writeFile(join(projectDir, 'package.json'), '{"name":"gi"}')
    await writeFile(join(projectDir, '.gitignore'), 'build/\ngenerated.ts\n')
    await mkdir(join(projectDir, 'src'), { recursive: true })
    await writeFile(join(projectDir, 'src', 'keep.ts'), 'export const keep = 1\n')
    await mkdir(join(projectDir, 'build'), { recursive: true })
    await writeFile(join(projectDir, 'build', 'out.ts'), 'export const out = 2\n')
    await writeFile(join(projectDir, 'generated.ts'), 'export const gen = 3\n')
    await writeFile(join(projectDir, 'README.md'), '# gi\n')

    await sync.addFolder(ws.id, projectDir)
    expect((await sync.classifyFolders(ws.id)).isCodebase).toBe(true)
    await sync.sync(ws.id)

    const db = auth.requireDatabase()
    await waitFor(async () =>
      (await db.documents().listDocumentsByWorkspace(ws.id)).some((d) =>
        d.sourcePath.endsWith('keep.ts'),
      ),
    )
    const paths = (await db.documents().listDocumentsByWorkspace(ws.id)).map((d) => d.sourcePath)
    expect(paths.some((p) => p.endsWith('keep.ts'))).toBe(true)
    expect(paths.some((p) => p.endsWith('README.md'))).toBe(true)
    // gitignored — would be indexed (.ts is code) if .gitignore were ignored:
    expect(paths.some((p) => p.includes('build'))).toBe(false)
    expect(paths.some((p) => p.endsWith('generated.ts'))).toBe(false)
  }, 20_000)

  it('indexes only the selected top-level dirs when there is no .gitignore (ADR-0006)', async () => {
    const ws = await new WorkspaceService(auth).create('INC')
    await auth.activate(ws.id)
    const sync = new FolderSyncService(auth, new DocumentService(auth))

    await writeFile(join(projectDir, 'package.json'), '{"name":"inc"}')
    await mkdir(join(projectDir, 'src'), { recursive: true })
    await writeFile(join(projectDir, 'src', 'app.ts'), 'export const app = 1\n')
    await mkdir(join(projectDir, 'samples'), { recursive: true })
    await writeFile(join(projectDir, 'samples', 'demo.ts'), 'export const demo = 1\n')
    await writeFile(join(projectDir, 'README.md'), '# inc\n')

    await sync.addFolder(ws.id, projectDir)
    expect((await sync.classifyFolders(ws.id)).isCodebase).toBe(true)
    // user picked only 'src' (no .gitignore present)
    await auth.requireDatabase().workspaces().setIndexDirs(ws.id, projectDir, ['src'])
    await sync.sync(ws.id)

    const db = auth.requireDatabase()
    await waitFor(async () =>
      (await db.documents().listDocumentsByWorkspace(ws.id)).some((d) =>
        d.sourcePath.endsWith('app.ts'),
      ),
    )
    const paths = (await db.documents().listDocumentsByWorkspace(ws.id)).map((d) => d.sourcePath)
    expect(paths.some((p) => p.endsWith('app.ts'))).toBe(true) // src/ included
    expect(paths.some((p) => p.endsWith('README.md'))).toBe(true) // root file always
    expect(paths.some((p) => p.endsWith('demo.ts'))).toBe(false) // samples/ excluded
  }, 20_000)
})
