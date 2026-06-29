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

export interface LaunchOptions {
  /** Extra Electron argv flags (after the main entry). The screenshot harness
   *  passes `--force-device-scale-factor=2` here for 2× DPR captures. */
  extraArgs?: string[]
  /** Resize the main window's CONTENT area to these logical pixels after launch
   *  (the screenshot checklist wants 1400×900). Omitted → the app's default. */
  contentSize?: { width: number; height: number }
}

export async function launchApp(opts: LaunchOptions = {}): Promise<LaunchedApp> {
  const userDataDir = await mkdtemp(join(tmpdir(), 'loklm-e2e-'))
  const mainEntry = resolve(__dirname, '..', '..', '..', 'out', 'main', 'index.js')

  const app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataDir}`, ...(opts.extraArgs ?? [])],
    env: { ...process.env, NODE_ENV: 'test' },
  })

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  if (opts.contentSize) {
    // Resize the native BrowserWindow's content area (page.setViewportSize does
    // not move an Electron window). Done in the main process via the window handle.
    const { width, height } = opts.contentSize
    await app.evaluate(
      ({ BrowserWindow }, size) => {
        const win = BrowserWindow.getAllWindows()[0]
        win?.setContentSize(size.width, size.height)
      },
      { width, height },
    )
    await page.waitForTimeout(150) // let the renderer reflow to the new size
  }

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
