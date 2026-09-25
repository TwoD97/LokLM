import { test, expect } from '@playwright/test'
import type { Api } from '../../src/preload'
import type { IndexProgress } from '../../src/shared/documents'
import type { ModelActivity } from '../../src/shared/modelActivity'
import { launchApp } from './helpers/launch'
import { registerAndUnlock, createWorkspace } from './helpers/seed'

// Opt in with LOKLM_TEST_PDF=<absolute path>. Uses installed models and a fresh
// temporary vault; never opens the user's vault or copies the PDF into the repo.
test('indexes a real PDF with live chunk progress and durable vectors', async () => {
  const testInfo = test.info()
  const pdf = process.env['LOKLM_TEST_PDF']
  test.skip(!pdf, 'Set LOKLM_TEST_PDF to run the real-model indexing regression')
  test.setTimeout(480_000)
  const launched = await launchApp()
  const { page, app } = launched
  app.process().stdout?.on('data', (data) => console.log(String(data).trim()))
  try {
    await registerAndUnlock(page, 'Indexing test')
    const workspaceId = await createWorkspace(page, 'Indexing test')
    await page.reload()
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const api = (globalThis as unknown as { api: Api }).api
            return (
              (await api.models.activity()).phase === 'idle' &&
              (await api.llm.status()).resident === true
            )
          }),
        { timeout: 180_000 },
      )
      .toBe(true)
    const constrainedGpu = await page.evaluate(async () => {
      const resources = (await (globalThis as unknown as { api: Api }).api.llm.info())
        .resources as { hasGpu?: boolean; totalVramGB?: number } | null
      const vram = resources?.totalVramGB
      return !!(
        resources?.hasGpu &&
        typeof vram === 'number' &&
        Number.isFinite(vram) &&
        vram > 0 &&
        vram <= 6
      )
    })
    await page.getByRole('button', { name: /^(Library|Bibliothek)$/ }).click({ timeout: 120_000 })
    await page.evaluate(() => {
      const state = globalThis as unknown as { api: Api; indexingEvents: IndexProgress[] }
      state.indexingEvents = []
      state.api.documents.onIndexProgress((p) => state.indexingEvents.push(p))
      const activity = globalThis as unknown as { activityEvents: ModelActivity[] }
      activity.activityEvents = []
      state.api.models.onActivity((event) => activity.activityEvents.push(event))
    })
    await app.evaluate(({ ipcMain }, sourcePath) => {
      ipcMain.removeHandler('documents:pickFiles')
      ipcMain.handle('documents:pickFiles', () => [sourcePath])
    }, pdf!)
    const started = Date.now()
    await page.locator('.library__drop').click()
    await expect(page.locator('dialog.model-activity')).toBeVisible({ timeout: 30_000 })
    await page.screenshot({ path: testInfo.outputPath('preparing-indexing.png') })
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const events = (globalThis as unknown as { indexingEvents: IndexProgress[] })
              .indexingEvents
            return events.some(
              (p) =>
                p.phase === 'embedding' &&
                (p.chunksDone ?? 0) > 0 &&
                (p.chunksDone ?? 0) < (p.chunksTotal ?? 0),
            )
          }),
        { timeout: 180_000 },
      )
      .toBe(true)
    await expect(page.locator('.library__indexing-detail').first()).toBeVisible()
    if (constrainedGpu)
      expect(
        await page.evaluate(() => (globalThis as unknown as { api: Api }).api.llm.status()),
      ).toMatchObject({ resident: false })
    await page.screenshot({ path: testInfo.outputPath('indexing-progress.png') })
    await expect
      .poll(
        async () =>
          page.evaluate(async (id) => {
            const api = (globalThis as unknown as { api: Api }).api
            const docs = await api.documents.list(id)
            return docs.length === 1 ? docs[0]?.status : null
          }, workspaceId),
        { timeout: 180_000 },
      )
      .toBe('ready')
    const result = await page.evaluate(async (id) => {
      const state = globalThis as unknown as { api: Api; indexingEvents: IndexProgress[] }
      const docs = await state.api.documents.list(id)
      return {
        chunks: docs[0]!.chunkCount,
        storage: await state.api.workspaces.storageEstimate(id),
        events: state.indexingEvents,
      }
    }, workspaceId)
    expect(result.chunks).toBeGreaterThan(0)
    expect(result.storage.vectorCount).toBe(result.chunks)
    expect(result.events.some((p) => p.phase === 'failed')).toBe(false)
    const indexedMs = Date.now() - started
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const api = (globalThis as unknown as { api: Api }).api
            return (await api.models.activity()).phase === 'idle'
          }),
        { timeout: 120_000 },
      )
      .toBe(true)
    const idleModels = await page.evaluate(async () => {
      const state = globalThis as unknown as { api: Api; activityEvents: ModelActivity[] }
      return {
        chat: await state.api.llm.status(),
        search: await state.api.embedder.status(),
        restored: state.activityEvents.some((event) => event.phase === 'restoring'),
      }
    })
    expect(idleModels.chat).toMatchObject({ state: 'ready', resident: !constrainedGpu })
    expect(idleModels.restored).toBe(!constrainedGpu)
    if (constrainedGpu) expect(idleModels.search).toMatchObject({ state: 'ready', resident: true })
    console.log(
      JSON.stringify({
        handoffMs: Date.now() - started,
        indexedMs,
        chunks: result.chunks,
        vectors: result.storage.vectorCount,
        progressEvents: result.events.length,
      }),
    )
    await page.screenshot({ path: testInfo.outputPath('indexing-complete.png') })
    // Stop a second run through the real UI. Cancellation must also release
    // the gate while preserving the same on-demand residency policy.
    await page.evaluate(async (id) => {
      const api = (globalThis as unknown as { api: Api }).api
      const docs = await api.documents.list(id)
      await api.documents.reindex(docs[0]!.id)
    }, workspaceId)
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const activity = await (globalThis as unknown as { api: Api }).api.models.activity()
            return activity.phase === 'indexing' && activity.jobs.some((job) => job.done > 0)
          }),
        { timeout: 60_000 },
      )
      .toBe(true)
    await page.getByRole('button', { name: /^(Stop indexing|Indexierung stoppen)$/ }).click()
    await expect
      .poll(
        () =>
          page.evaluate(
            async ({ id, expectedResident }) => {
              const api = (globalThis as unknown as { api: Api }).api
              const docs = await api.documents.list(id)
              return (
                docs[0]?.status === 'failed' &&
                (await api.models.activity()).phase === 'idle' &&
                (await api.llm.status()).resident === expectedResident
              )
            },
            { id: workspaceId, expectedResident: !constrainedGpu },
          ),
        { timeout: 120_000 },
      )
      .toBe(true)
    // A deliberate warmup still restores chat after the canceled job; it is
    // not performed automatically on constrained GPUs.
    await page.evaluate(() => (globalThis as unknown as { api: Api }).api.models.warmupForQa())
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const api = (globalThis as unknown as { api: Api }).api
            return (
              (await api.models.activity()).phase === 'idle' &&
              (await api.llm.status()).resident === true
            )
          }),
        { timeout: 120_000 },
      )
      .toBe(true)
  } finally {
    await launched.cleanup()
  }
})
