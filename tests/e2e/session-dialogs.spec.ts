import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Api } from '../../src/preload'
import type { Document } from '../../src/shared/documents'
import { launchApp } from './helpers/launch'
import { createWorkspace, registerAndUnlock } from './helpers/seed'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })

interface DialogState {
  original: typeof import('electron').dialog.showOpenDialog
  opened: number
  resolve: ((result: Electron.OpenDialogReturnValue) => void) | null
}
interface PendingPicker {
  state: 'pending' | 'resolved' | 'rejected'
  value?: Document | null
  message?: string
}

async function holdOpenDialogs(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ dialog }) => {
    const globals = globalThis as unknown as { sessionTestDialog?: DialogState }
    if (globals.sessionTestDialog) throw new Error('Dialog harness already installed')
    const state: DialogState = { original: dialog.showOpenDialog, opened: 0, resolve: null }
    globals.sessionTestDialog = state
    dialog.showOpenDialog = () => {
      if (state.resolve) return Promise.reject(new Error('An earlier picker is still pending'))
      state.opened++
      return new Promise<Electron.OpenDialogReturnValue>((resolve) => {
        state.resolve = resolve
      })
    }
  })
}

async function resolveDialog(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate((_electron, chosenPath) => {
    const state = (globalThis as unknown as { sessionTestDialog?: DialogState }).sessionTestDialog
    if (!state?.resolve) throw new Error('Expected a pending native file picker')
    const finish = state.resolve
    state.resolve = null
    finish({ canceled: false, filePaths: [chosenPath] })
  }, path)
}

async function waitForDialog(app: ElectronApplication, count: number): Promise<void> {
  await expect
    .poll(() =>
      app.evaluate(
        () =>
          (globalThis as unknown as { sessionTestDialog?: DialogState }).sessionTestDialog
            ?.opened ?? 0,
      ),
    )
    .toBe(count)
}

async function waitForPicker(page: Page): Promise<PendingPicker> {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (globalThis as unknown as { sessionTestPicker: PendingPicker }).sessionTestPicker.state,
      ),
    )
    .not.toBe('pending')
  return page.evaluate(
    () => (globalThis as unknown as { sessionTestPicker: PendingPicker }).sessionTestPicker,
  )
}

test('pending native pickers retain their originating vault session and document workspace', async () => {
  test.skip(
    process.env['LOKLM_NATIVE_SESSION_DIALOGS'] !== '1',
    'Requires isolated native app and available models',
  )
  test.setTimeout(480_000)
  const launched = await launchApp()
  const { app, page, userDataDir } = launched
  try {
    await registerAndUnlock(page, 'Session picker regression')
    const originalWorkspace = await createWorkspace(page, 'Original picker library')
    // Both exist before login so AppShell's real workspace list includes them.
    const otherWorkspace = await createWorkspace(page, 'Other picker library')
    const watchedFolder = join(userDataDir, 'pending-folder')
    await mkdir(watchedFolder)
    await holdOpenDialogs(app)

    await page.evaluate((workspaceId) => {
      const globals = globalThis as unknown as { api: Api; sessionTestPicker: PendingPicker }
      globals.sessionTestPicker = { state: 'pending' }
      void globals.api.workspaces.addSyncFolder(workspaceId).then(
        () => {
          globals.sessionTestPicker = { state: 'resolved' }
        },
        (error: unknown) => {
          globals.sessionTestPicker = {
            state: 'rejected',
            message: error instanceof Error ? error.message : String(error),
          }
        },
      )
    }, originalWorkspace)
    await waitForDialog(app, 1)
    await page.evaluate(() => (globalThis as unknown as { api: Api }).api.auth.lock())
    expect(
      await page.evaluate(() =>
        (globalThis as unknown as { api: Api }).api.auth.login('Demo-Vault-2026!'),
      ),
    ).toEqual({ ok: true })
    await page
      .getByRole('button', {
        name: /Open workspace|Arbeitsbereich.*ffnen|trotzdem|continue|überspringen|weiter/i,
      })
      .first()
      .click({ timeout: 8000 })
      .catch(() => undefined)
    await expect(page.getByRole('button', { name: /^(Library|Bibliothek)$/ })).toBeVisible({
      timeout: 120_000,
    })
    const selectWorkspace = async (name: string): Promise<void> => {
      await page.getByRole('button', { name: /^(Library|Bibliothek)$/ }).click()
      const toggle = page.locator('.sidebar__toggle')
      if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
      // Workspace buttons also name their encryption/type icon for assistive technology.
      await page.getByRole('button', { name }).click()
      // LibraryView renders only after the shell's awaited backend activation.
      await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible()
    }
    await selectWorkspace('Original picker library')
    await resolveDialog(app, watchedFolder)
    const retired = await waitForPicker(page)
    expect(retired.state).toBe('rejected')
    expect(retired.message).toMatch(/abort|cancel|lock|session/i)
    expect(
      await page.evaluate(
        (id) => (globalThis as unknown as { api: Api }).api.workspaces.listSyncFolders(id),
        originalWorkspace,
      ),
    ).toEqual([])
    expect(
      await page.evaluate(
        (id) => (globalThis as unknown as { api: Api }).api.documents.list(id),
        originalWorkspace,
      ),
    ).toEqual([])

    // Save tiny synthetic generated sources through real IPC. Each workspace
    // begins empty, so both local document sequences deliberately produce ID 1.
    const originals = await page.evaluate(
      async ({ first, second }) => {
        const api = (globalThis as unknown as { api: Api }).api
        const a = await api.translation.saveDocument(
          first,
          'Original A',
          'Library A keeps the blue notebook.',
          'en',
        )
        const b = await api.translation.saveDocument(
          second,
          'Original B',
          'Library B keeps the green notebook.',
          'en',
        )
        return { a, b }
      },
      { first: originalWorkspace, second: otherWorkspace },
    )
    expect(originals.a.id).toBe(originals.b.id)
    expect(originals.a.workspaceId).not.toBe(originals.b.workspaceId)
    await expect
      .poll(
        async () =>
          page.evaluate(
            async (ids) => {
              const api = (globalThis as unknown as { api: Api }).api
              const lists = await Promise.all(ids.map((id) => api.documents.list(id)))
              return lists.every((docs) => docs.length === 1 && docs[0]?.status === 'ready')
            },
            [originalWorkspace, otherWorkspace],
          ),
        { timeout: 180_000 },
      )
      .toBe(true)
    const probes = await page.evaluate(
      async ({ first, second }) => {
        const api = (globalThis as unknown as { api: Api }).api
        return {
          a: await api.conversations.create(first, 'Workspace identity A'),
          b: await api.conversations.create(second, 'Workspace identity B'),
        }
      },
      { first: originalWorkspace, second: otherWorkspace },
    )
    expect(probes.a.id).toBe(probes.b.id)
    const replacement = join(userDataDir, 'replacement.txt')
    const replacementText =
      'Library A now keeps the silver notebook. Replacement source only for A.'
    await writeFile(replacement, replacementText)
    await selectWorkspace('Original picker library')
    await page.evaluate((documentId) => {
      const globals = globalThis as unknown as { api: Api; sessionTestPicker: PendingPicker }
      globals.sessionTestPicker = { state: 'pending' }
      void globals.api.documents.replaceSource(documentId).then(
        (value) => {
          globals.sessionTestPicker = { state: 'resolved', value }
        },
        (error: unknown) => {
          globals.sessionTestPicker = {
            state: 'rejected',
            message: error instanceof Error ? error.message : String(error),
          }
        },
      )
    }, originals.a.id)
    await waitForDialog(app, 2)
    await selectWorkspace('Other picker library')
    const beforeResolve = await page.evaluate(
      async ({ conversationId, documentId }) => {
        const api = (globalThis as unknown as { api: Api }).api
        return {
          activeWorkspaceId: (await api.conversations.getWithMessages(conversationId)).conversation
            .workspaceId,
          source: await api.documents.readGeneratedText(documentId),
        }
      },
      { conversationId: probes.b.id, documentId: originals.b.id },
    )
    expect(beforeResolve).toEqual({
      activeWorkspaceId: otherWorkspace,
      source: 'Library B keeps the green notebook.',
    })
    await resolveDialog(app, replacement)
    const changed = await waitForPicker(page)
    expect(changed).toMatchObject({
      state: 'resolved',
      value: { id: originals.a.id, workspaceId: originalWorkspace, sourcePath: replacement },
    })
    await expect
      .poll(
        async () =>
          page.evaluate(async (id) => {
            const docs = await (globalThis as unknown as { api: Api }).api.documents.list(id)
            return docs[0]?.status
          }, originalWorkspace),
        { timeout: 180_000 },
      )
      .toBe('ready')
    const after = await page.evaluate(
      async ({ first, second, secondDocumentId, conversationId }) => {
        const api = (globalThis as unknown as { api: Api }).api
        // The active library remains B; background reindexing A must not change it.
        const bSource = await api.documents.readGeneratedText(secondDocumentId)
        return {
          a: await api.documents.list(first),
          b: await api.documents.list(second),
          bSource,
          activeWorkspaceId: (await api.conversations.getWithMessages(conversationId)).conversation
            .workspaceId,
        }
      },
      {
        first: originalWorkspace,
        second: otherWorkspace,
        secondDocumentId: originals.b.id,
        conversationId: probes.b.id,
      },
    )
    await test.info().attach('picker-workspace-identity.json', {
      body: JSON.stringify({
        originalWorkspace,
        otherWorkspace,
        beforeResolve,
        after: {
          activeWorkspaceId: after.activeWorkspaceId,
          source: after.bSource,
        },
      }),
      contentType: 'application/json',
    })
    expect(after.activeWorkspaceId).toBe(otherWorkspace)
    expect(after.a).toHaveLength(1)
    expect(after.a[0]).toMatchObject({
      id: originals.a.id,
      sourcePath: replacement,
      title: 'replacement.txt',
      status: 'ready',
    })
    expect(after.b).toHaveLength(1)
    expect(after.b[0]).toMatchObject({
      id: originals.b.id,
      sourcePath: originals.b.sourcePath,
      title: originals.b.title,
      contentHash: originals.b.contentHash,
    })
    expect(after.bSource).toBe('Library B keeps the green notebook.')
    await selectWorkspace('Original picker library')
    const chunks = await page.evaluate(
      (id) => (globalThis as unknown as { api: Api }).api.documents.listChunksForDocument(id),
      originals.a.id,
    )
    expect(chunks.map((chunk) => chunk.text).join('\n')).toContain('silver notebook')
  } finally {
    await app
      .evaluate(({ dialog }) => {
        const globals = globalThis as unknown as { sessionTestDialog?: DialogState }
        const state = globals.sessionTestDialog
        if (!state) return
        state.resolve?.({ canceled: true, filePaths: [] })
        dialog.showOpenDialog = state.original
        delete globals.sessionTestDialog
      })
      .catch(() => undefined)
    await launched.cleanup()
  }
})
