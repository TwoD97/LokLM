import { test, expect } from '@playwright/test'
import { launchApp, type LaunchedApp } from './helpers/launch'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ADR-0006: the top-bar embedder dot must say "Code embedder" when the
// code-specialised model (jina-code) is the resident embedder. Requires the
// jina-code GGUF in <repo>/models (dev model dir).

test.setTimeout(180_000)

let launched: LaunchedApp

async function registerAndUnlock(l: LaunchedApp): Promise<void> {
  const { page } = l
  await expect(page.getByRole('heading', { level: 1, name: 'Konto anlegen' })).toBeVisible()
  await page.getByLabel('Anzeigename').fill('Bar Bot')
  const pw = page.locator('input[type="password"]')
  await pw.nth(0).fill('Pass123456')
  await pw.nth(1).fill('Pass123456')
  await page.getByRole('button', { name: 'Konto anlegen' }).click()
  await expect(page.getByRole('heading', { name: 'Wiederherstellungs-Wörter' })).toBeVisible()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Weiter' }).click()
  await expect(page.getByText(/Workspace/i).first()).toBeVisible({ timeout: 20_000 })
}

test.beforeEach(async () => {
  launched = await launchApp()
  await registerAndUnlock(launched)
})
test.afterEach(async () => {
  await launched.cleanup()
})

test('top-bar embedder dot reads "Code embedder" when jina-code is resident', async () => {
  const { page } = launched
  const repo = await mkdtemp(join(tmpdir(), 'bar-'))
  await writeFile(join(repo, 'package.json'), '{"name":"bar","type":"module"}')
  await writeFile(join(repo, '.gitignore'), 'dist/\n') // present ⇒ no dir-picker, auto-sync
  await mkdir(join(repo, 'src'), { recursive: true })
  await writeFile(join(repo, 'src', 'a.ts'), 'export const a = 1\n')
  await launched.app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [picked] })) as never
  }, repo)

  const api = 'window.api'
  const ws = (await page.evaluate(`${api}.workspaces.create('Bar')`)) as { id: number }
  await page.evaluate(`${api}.workspaces.setType(${ws.id}, 'codebase')`)
  await page.evaluate(`${api}.workspaces.activate(${ws.id})`)
  await page.evaluate(`${api}.workspaces.addSyncFolder(${ws.id})`)
  await page.evaluate(`${api}.workspaces.syncNow(${ws.id})`) // embeds → loads jina-code

  // poll the IPC status to confirm jina-code is the resident model
  await expect
    .poll(
      async () =>
        ((await page.evaluate(`${api}.embedder.status()`)) as { modelName: string | null })
          .modelName,
      { timeout: 120_000 },
    )
    .toMatch(/jina-code/i)

  // the top-bar dot's accessible label reflects it (StatusDot aria-label embeds the label)
  await expect(page.locator('[role="img"][aria-label*="Code embedder"]')).toHaveCount(1)
  // and the doc-model label is NOT shown for the embedder dot
  const codeLabel = await page
    .locator('.titlebar__pill-label', { hasText: 'Code embedder' })
    .count()
  expect(codeLabel).toBe(1)
})
