import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

// startet die gebaute electron-app mit eigenem userData-verzeichnis.
// userData wird über env -> getPath('userData') gar nicht direkt überschrieben ,
// aber electron akzeptiert --user-data-dir als argv flag und respektiert das.

export interface LaunchedApp {
  app: ElectronApplication
  page: Page
  userDataDir: string
  cleanup(): Promise<void>
}

export async function launchApp(): Promise<LaunchedApp> {
  const userDataDir = await mkdtemp(join(tmpdir(), 'loklm-e2e-'))
  const mainEntry = resolve(__dirname, '..', '..', '..', 'out', 'main', 'index.js')

  const app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataDir}`],
    env: { ...process.env, NODE_ENV: 'test' },
  })

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  return {
    app,
    page,
    userDataDir,
    cleanup: async () => {
      await app.close().catch(() => undefined)
      await rm(userDataDir, { recursive: true, force: true })
    },
  }
}
