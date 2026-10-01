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
  /** Restart the same isolated profile and vault without inheriting host paths. */
  restart(): Promise<void>
  cleanup(): Promise<void>
}

export interface LaunchOptions {
  /** Keep background tests off the desktop; opt in for interactive debugging. */
  visible?: boolean
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
  // CLI tooling can set this for native-module checks. Electron GUI tests must
  // run as the application, otherwise Chromium flags are rejected by Node.
  // Use the built renderer, never an inherited development-server URL.
  const env: Record<string, string> = Object.fromEntries(
    Object.entries({
      ...process.env,
      NODE_ENV: 'test',
      // This override takes precedence over --user-data-dir in the app. Never
      // inherit a developer's explicit vault path into an isolated test run.
      LOKLM_DATA_DIR: join(userDataDir, 'vault'),
    }).filter(
      (entry): entry is [string, string] =>
        entry[0] !== 'ELECTRON_RUN_AS_NODE' &&
        entry[0] !== 'ELECTRON_RENDERER_URL' &&
        typeof entry[1] === 'string',
    ),
  )

  const start = async (): Promise<{ app: ElectronApplication; page: Page }> => {
    const app = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userDataDir}`, ...(opts.extraArgs ?? [])],
      env,
    })
    try {
      const page = await app.firstWindow()
      await app.evaluate(({ BrowserWindow }, visible) => {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.setBackgroundThrottling(false)
          if (!visible) window.hide()
        }
      }, opts.visible === true)
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
      return { app, page }
    } catch (error) {
      await app.close().catch(() => undefined)
      throw error
    }
  }
  let running: { app: ElectronApplication; page: Page }
  try {
    running = await start()
  } catch (error) {
    await rm(userDataDir, { recursive: true, force: true })
    throw error
  }
  const launched: LaunchedApp = {
    ...running,
    userDataDir,
    restart: async () => {
      await running.app.close()
      running = await start()
      launched.app = running.app
      launched.page = running.page
    },
    cleanup: async () => {
      await running.app.close().catch(() => undefined)
      await rm(userDataDir, { recursive: true, force: true })
    },
  }
  return launched
}
