import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthService } from '@main/services/auth/AuthService'
import { WorkspaceService } from '@main/services/documents/WorkspaceService'
import { DocumentService } from '@main/services/documents/DocumentService'
import type { IndexProgress } from '@main/services/documents/types'

describe('DocumentService.importFile (integration)', () => {
  let dir: string
  let auth: AuthService

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'loklm-doc-'))
    auth = new AuthService(dir)
    await auth.register({ displayName: 'Tst', password: 'Test12345!', recoveryLang: 'en' })
  })
  afterEach(async () => {
    await auth.lock().catch(() => undefined)
    await rm(dir, { recursive: true, force: true })
  })

  it('imports a markdown file → ready, chunks present', async () => {
    const ws = await new WorkspaceService(auth).create('WS')
    const path = join(dir, 'sample.md')
    await writeFile(path, '# Hello\n\nFirst paragraph.\n\nSecond paragraph.', 'utf-8')

    const sent: IndexProgress[] = []
    const fakeSender = { send: (_ch: string, payload: IndexProgress) => sent.push(payload) }
    const docs = new DocumentService(auth)
    const doc = await docs.importFile({
      workspaceId: ws.id,
      sourcePath: path,
      sender: fakeSender as unknown as Electron.WebContents,
    })
    expect(doc.status).toBe('pending')

    await waitFor(() => sent.some((e) => e.phase === 'done' || e.phase === 'failed'), 5000)
    expect(sent.at(-1)?.phase).toBe('done')

    const refreshed = await auth.requireDatabase().documents().getDocument(doc.id)
    expect(refreshed?.status).toBe('ready')
    expect(refreshed?.chunkCount).toBeGreaterThan(0)
  }, 30_000)

  it('rejects unsupported extensions', async () => {
    const ws = await new WorkspaceService(auth).create('WS')
    const docs = new DocumentService(auth)
    await expect(
      docs.importFile({ workspaceId: ws.id, sourcePath: '/tmp/foo.xyz' }),
    ).rejects.toThrow(/unsupported/i)
  })

  it('rejects files over 50 MB', async () => {
    const ws = await new WorkspaceService(auth).create('WS')
    const path = join(dir, 'big.txt')
    const fh = await (await import('node:fs/promises')).open(path, 'w')
    await fh.truncate(51 * 1024 * 1024)
    await fh.close()
    const docs = new DocumentService(auth)
    await expect(docs.importFile({ workspaceId: ws.id, sourcePath: path })).rejects.toThrow(
      /50 MB/i,
    )
  })
})

async function waitFor(check: () => boolean, ms: number): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('waitFor timeout')
    await new Promise((r) => setTimeout(r, 25))
  }
}
