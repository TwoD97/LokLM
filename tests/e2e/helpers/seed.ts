import { expect, type Page } from '@playwright/test'

// The Node-side tsconfig has no DOM lib, so `window` is untyped inside
// page.evaluate. Route through `globalThis` (in `window` is the global object)
// with a minimal local view of the preload API surface we actually call.
interface SeedApi {
  workspaces: {
    create(name: string, encrypted: boolean): Promise<{ id: number }>
    activate(id: number): Promise<unknown>
  }
  documents: {
    import(workspaceId: number, sourcePath: string): Promise<unknown>
    list(workspaceId: number): Promise<Array<{ status?: string }>>
  }
}

/**
 * Demo vault seeding for the screenshot harness. Registration is driven through
 * the real UI (the app default language is German — see app.spec.ts); document
 * import goes through the EXPOSED IPC (`window.api.documents.import`, the same
 * call the drop-zone uses after resolving paths) because the click path opens a
 * native file dialog Playwright can't drive.
 *
 * NOTE: indexing needs the embedder model present in the model dir (./models for
 * the unpackaged e2e build). Without it, import leaves docs unindexed and the
 * content captures will be empty — run with the tier models installed.
 */

const PASSWORD = 'Demo-Vault-2026!'

/** Register a fresh vault and land on the unlocked app shell. */
export async function registerAndUnlock(page: Page, displayName = 'Demo'): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: 'Konto anlegen' })).toBeVisible()
  await page.getByLabel('Anzeigename').fill(displayName)
  const pw = page.locator('input[type="password"]')
  await pw.nth(0).fill(PASSWORD)
  await pw.nth(1).fill(PASSWORD)
  await page.getByRole('button', { name: 'Konto anlegen' }).click()

  // Recovery-phrase reveal: confirm the checkbox and continue.
  const checkbox = page.locator('input[type="checkbox"]').first()
  await checkbox.waitFor({ state: 'visible', timeout: 20_000 })
  await checkbox.check()
  await page
    .getByRole('button', { name: /weiter|nächst|next/i })
    .first()
    .click()

  // Warming screen → unlocked. Skip the wait if a "continue anyway" escape shows.
  const skip = page.getByRole('button', { name: /trotzdem|continue|überspringen|weiter/i })
  await skip
    .first()
    .click({ timeout: 8_000 })
    .catch(() => undefined)

  // Unlocked when the nav rail is present.
  await expect(page.getByRole('button', { name: 'Library' })).toBeVisible({ timeout: 120_000 })
}

/** Create a (non-encrypted) workspace via the API and return its id. */
export async function createWorkspace(page: Page, name = 'Demo'): Promise<number> {
  const id = await page.evaluate(async (wsName) => {
    const api = (globalThis as unknown as { api: SeedApi }).api
    const ws = await api.workspaces.create(wsName, false)
    await api.workspaces.activate(ws.id)
    return ws.id
  }, name)
  return id
}

/**
 * Import the given absolute paths into the workspace and wait until every doc
 * reports an indexed state (or the timeout elapses). Returns the imported count.
 */
export async function importAndIndex(
  page: Page,
  workspaceId: number,
  absPaths: string[],
  timeoutMs = 240_000,
): Promise<number> {
  const imported = await page.evaluate(
    async ({ id, paths }) => {
      const api = (globalThis as unknown as { api: SeedApi }).api
      let ok = 0
      for (const p of paths) {
        try {
          await api.documents.import(id, p)
          ok++
        } catch {
          /* skip unreadable / unsupported */
        }
      }
      return ok
    },
    { id: workspaceId, paths: absPaths },
  )

  // Poll the document list until nothing is still pending/indexing.
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const pending = await page.evaluate(async (id) => {
      const api = (globalThis as unknown as { api: SeedApi }).api
      const docs = await api.documents.list(id)
      return docs.filter((d) => {
        const s = String(d.status ?? '').toLowerCase()
        return s === '' || s === 'pending' || s === 'indexing' || s === 'queued'
      }).length
    }, workspaceId)
    if (pending === 0 || Date.now() > deadline) break
    await page.waitForTimeout(2_000)
  }
  return imported
}
