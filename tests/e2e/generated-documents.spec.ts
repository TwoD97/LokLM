import { test, expect } from '@playwright/test'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Api } from '../../src/preload'
import { launchApp } from './helpers/launch'
import { registerAndUnlock, createWorkspace } from './helpers/seed'

test('generated sources survive cancel, reindex and restart without plaintext staging', async () => {
  test.skip(
    process.env['LOKLM_NATIVE_DOCUMENTS'] !== '1',
    'Requires installed models and a free GPU',
  )
  test.setTimeout(480_000)
  const launched = await launchApp()
  const source =
    '# Encrypted source regression\n\nThe brass observatory opens at 07:15 on Thursdays.\n'
  const transcript = 'Transcript regression: the final delivery is scheduled for 18 November.'
  const errors: string[] = []
  try {
    let page = launched.page
    page.on('pageerror', (error) => errors.push(error.message))
    await registerAndUnlock(page, 'Generated source regression')
    const workspaceId = await createWorkspace(page, 'Generated sources')
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const api = (globalThis as unknown as { api: Api }).api
            return (await api.models.activity()).phase
          }),
        { timeout: 180_000 },
      )
      .toBe('idle')
    const ids = await page.evaluate(
      async ({ workspaceId, source, transcript }) => {
        const api = (globalThis as unknown as { api: Api }).api
        const translation = await api.translation.saveDocument(
          workspaceId,
          'Source report.txt',
          source,
          'en',
        )
        const audio = await api.transcription.saveToWorkspace(workspaceId, transcript, 'txt')
        await api.documents.cancelIndexing(workspaceId)
        return { translation: translation.id, audio: audio.id }
      },
      { workspaceId, source, transcript },
    )
    const readSources = () =>
      page.evaluate(async (ids) => {
        const api = (globalThis as unknown as { api: Api }).api
        return {
          translation: await api.documents.readGeneratedText(ids.translation),
          audio: await api.documents.readGeneratedText(ids.audio),
        }
      }, ids)
    expect(await readSources()).toEqual({ translation: source, audio: transcript })
    // Generated text is persisted before background indexing and remains
    // recoverable even when the user cancels that first indexing attempt.
    await expect
      .poll(
        () =>
          page.evaluate(async (id) => {
            const docs = await (globalThis as unknown as { api: Api }).api.documents.list(id)
            return docs.every((doc) => !['pending', 'indexing'].includes(doc.status))
          }, workspaceId),
        { timeout: 120_000 },
      )
      .toBe(true)
    const exportPath = join(launched.userDataDir, 'explicit-export.md')
    await launched.app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    }, exportPath)
    expect(
      await page.evaluate(
        (id) => (globalThis as unknown as { api: Api }).api.documents.exportDocument(id),
        ids.translation,
      ),
    ).toMatchObject({ ok: true })
    expect(await readFile(exportPath, 'utf8')).toBe(source)
    await page.evaluate(async (ids) => {
      const api = (globalThis as unknown as { api: Api }).api
      await api.documents.reindex(ids.translation)
      await api.documents.reindex(ids.audio)
    }, ids)
    await expect
      .poll(
        () =>
          page.evaluate(async (id) => {
            const docs = await (globalThis as unknown as { api: Api }).api.documents.list(id)
            return (
              docs.length === 2 && docs.every((doc) => doc.status === 'ready' && doc.chunkCount > 0)
            )
          }, workspaceId),
        { timeout: 180_000 },
      )
      .toBe(true)
    expect(await readSources()).toEqual({ translation: source, audio: transcript })
    await page.evaluate(() => (globalThis as unknown as { api: Api }).api.auth.lock())
    await expect(
      page.evaluate(
        (id) => (globalThis as unknown as { api: Api }).api.documents.readGeneratedText(id),
        ids.translation,
      ),
    ).rejects.toThrow(/locked/i)
    await launched.restart()
    page = launched.page
    page.on('pageerror', (error) => errors.push(error.message))
    expect(
      await page.evaluate(() =>
        (globalThis as unknown as { api: Api }).api.auth.login('Demo-Vault-2026!'),
      ),
    ).toEqual({ ok: true })
    await page.evaluate(
      (id) => (globalThis as unknown as { api: Api }).api.workspaces.activate(id),
      workspaceId,
    )
    expect(await readSources()).toEqual({ translation: source, audio: transcript })
    await page.evaluate(() => (globalThis as unknown as { api: Api }).api.auth.lock())
    const vault = join(launched.userDataDir, 'vault')
    for (const entry of await readdir(vault, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue
      const bytes = await readFile(join(entry.parentPath, entry.name))
      expect(bytes.includes(Buffer.from('The brass observatory')), entry.name).toBe(false)
      expect(bytes.includes(Buffer.from('the final delivery is scheduled')), entry.name).toBe(false)
    }
    expect(errors).toEqual([])
  } finally {
    await launched.cleanup()
  }
})
