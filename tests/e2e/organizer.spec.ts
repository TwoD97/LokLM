import {
  _electron as electron,
  test,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import type { Api } from '../../src/preload'

const PASSWORD = 'Organizer-regression-42!'
const RECOVERED_PASSWORD = 'Organizer-recovered-43!'

// This spec deliberately does not use the legacy launch helper: BOTH the vault
// and Chromium profile must be isolated, and Electron must not inherit Node mode.
test('organizer and workspace preferences survive lock, login and application restart', async () => {
  test.setTimeout(240_000)
  const dataRoot = await mkdtemp(join(tmpdir(), 'loklm-organizer-e2e-'))
  // Verify the immutable recursive-delete target before launching the test.
  const relativePath = relative(resolve(tmpdir()), resolve(dataRoot))
  if (relativePath.startsWith('..') || !basename(dataRoot).startsWith('loklm-organizer-e2e-'))
    throw new Error('Refusing to use a path outside the organizer test directory')
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
  env.NODE_ENV = 'test'
  env.LOKLM_DATA_DIR = join(dataRoot, 'vault')
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  let app: ElectronApplication | undefined
  const pageErrors: string[] = []
  const launch = async (): Promise<Page> => {
    app = await electron.launch({
      args: [resolve('out/main/index.js'), `--user-data-dir=${join(dataRoot, 'chromium')}`],
      env,
      timeout: 30_000,
    })
    const page = await app.firstWindow()
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.setBackgroundThrottling(false)
        window.hide()
      }
    })
    await page.waitForLoadState('domcontentloaded')
    await page.waitForFunction(() =>
      Boolean((globalThis as unknown as { api?: Api }).api?.organizer),
    )
    return page
  }
  const enterWorkspace = async (page: Page) => {
    await expect
      .poll(
        async () => {
          if (await page.locator('.app-shell').isVisible()) return true
          const continueButton = page.getByRole('button', {
            name: /Open workspace|Arbeitsbereich.*ffnen/,
          })
          if (await continueButton.isVisible()) await continueButton.click()
          return page.locator('.app-shell').isVisible()
        },
        { timeout: 30_000 },
      )
      .toBe(true)
  }
  const readState = (page: Page) =>
    page.evaluate(async () => {
      const currentApi = (globalThis as unknown as { api: Api }).api
      const settings = await currentApi.settings.get()
      return {
        organizer: await currentApi.organizer.list(),
        preferences: {
          modules: settings.basic.modules,
          startView: settings.basic.startView,
          weekStartsOn: settings.basic.weekStartsOn,
          theme: settings.basic.theme,
        },
      }
    })
  const expectLockedOrganizer = async (page: Page) => {
    const error = await page.evaluate(async () => {
      try {
        await (globalThis as unknown as { api: Api }).api.organizer.list()
        return null
      } catch (error) {
        return String(error)
      }
    })
    expect(error).toMatch(/locked/i)
  }
  const expectSavedShell = async (page: Page) => {
    await enterWorkspace(page)
    const nav = page.locator('.sidebar__rail')
    await expect(nav.getByRole('button', { name: /^(Notes|Notizen)$/ })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(nav.getByRole('button', { name: /^Quiz$/ })).toHaveCount(0)
    await expect.poll(() => page.evaluate('document.documentElement.dataset.theme')).toBe('dark')
    await page.locator('.organizer__note-item').filter({ hasText: 'Flight plan' }).click()
    await expect(page.locator('textarea[name="note-body"]')).toHaveValue(
      'Keep the rollout focused.\nConfirm the next step with the team.',
    )
  }
  try {
    let page = await launch()
    const initial = await page.evaluate(() =>
      (globalThis as unknown as { api: Api }).api.auth.status(),
    )
    expect(initial.registered).toBe(false)
    await expectLockedOrganizer(page)
    // Exercise the production auth IPC. Recovery words stay inside the disposable
    // test vault/session and are never printed or saved as a test artifact.
    await page.evaluate(async (password) => {
      const testWindow = globalThis as unknown as { api: Api; organizerRecovery?: string }
      const result = await testWindow.api.auth.register('Organizer regression', password, 'en')
      // Keep the disposable recovery phrase inside this renderer only. Never
      // return it through Playwright, print it, or write it to an artifact.
      testWindow.organizerRecovery = result.passphrase.join(' ')
    }, PASSWORD)
    await enterWorkspace(page)

    await page.evaluate(async () => {
      const currentApi = (globalThis as unknown as { api: Api }).api
      const now = new Date()
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      await currentApi.organizer.saveTask({
        title: 'Ship release',
        completed: false,
        dueDate: date,
      })
      await currentApi.organizer.saveEvent({
        title: 'Planning session',
        date,
        startTime: '10:00',
        endTime: '10:30',
        details: 'Review the release checklist.',
      })
    })
    const nav = page.locator('.sidebar__rail')
    await nav.getByRole('button', { name: /^(Notes|Notizen)$/ }).click()
    await page.locator('input[name="note-title"]').fill('Flight plan')
    await page
      .locator('textarea[name="note-body"]')
      .fill('Keep the rollout focused.\nConfirm the next step with the team.')
    await page.getByRole('button', { name: /^(Save note|Notiz speichern)$/ }).click()
    await expect(
      page.locator('.organizer__note-item').filter({ hasText: 'Flight plan' }),
    ).toBeVisible()

    await nav.getByRole('button', { name: /^(Calendar|Kalender)$/ }).click()
    await expect(
      page.locator('.organizer__agenda').getByText('Planning session', { exact: true }),
    ).toBeVisible()
    await expect(
      page.locator('.organizer__agenda').getByText('Ship release', { exact: true }),
    ).toBeVisible()
    await nav.getByRole('button', { name: /^(To-dos|Aufgaben)$/ }).click()
    // This controlled checkbox updates after its durable IPC save, so observe
    // the saved state rather than requiring check()'s synchronous DOM change.
    await page.getByRole('checkbox', { name: /Ship release/ }).click()
    await expect.poll(async () => (await readState(page)).organizer.tasks[0]?.completed).toBe(true)

    await page.getByRole('button', { name: /^(Settings|Einstellungen)$/ }).click()
    const preferences = page.locator('.settings-modal')
    await preferences.getByRole('radio', { name: /^(Dark|Dunkel)$/ }).click()
    await preferences.getByRole('tab', { name: /^(Modules|Module)$/ }).click()
    const quizSwitch = preferences.getByRole('switch', { name: /^Quiz$/ })
    await quizSwitch.click()
    await expect(quizSwitch).not.toBeChecked()
    const startView = preferences.getByLabel(/Open on launch|Ansicht beim Start/)
    await startView.selectOption('notes')
    await expect(startView).toHaveValue('notes')
    const weekStart = preferences.getByLabel(/Week starts on|Wochenbeginn/)
    await weekStart.selectOption('0')
    await expect(weekStart).toHaveValue('0')
    await page.keyboard.press('Escape')
    await expect(preferences).toBeHidden()
    await expect(nav.getByRole('button', { name: /^Quiz$/ })).toHaveCount(0)
    const saved = await readState(page)
    expect(saved.organizer.notes).toHaveLength(1)
    expect(saved.organizer.events).toHaveLength(1)

    await page.evaluate(() => (globalThis as unknown as { api: Api }).api.auth.lock())
    await expectLockedOrganizer(page)
    expect(
      await page.evaluate(
        (password) => (globalThis as unknown as { api: Api }).api.auth.login(password),
        PASSWORD,
      ),
    ).toEqual({ ok: true })
    await expectSavedShell(page)
    expect(await readState(page)).toEqual(saved)

    await page.evaluate(() => (globalThis as unknown as { api: Api }).api.auth.lock())
    await expectLockedOrganizer(page)
    expect(
      await page.evaluate(async (password) => {
        const testWindow = globalThis as unknown as { api: Api; organizerRecovery?: string }
        if (!testWindow.organizerRecovery) throw new Error('Disposable recovery phrase missing')
        const result = await testWindow.api.auth.reset(testWindow.organizerRecovery, password)
        delete testWindow.organizerRecovery
        return result.ok
      }, RECOVERED_PASSWORD),
    ).toBe(true)
    await expectSavedShell(page)
    expect(await readState(page)).toEqual(saved)

    await app!.close()
    app = undefined
    page = await launch()
    expect(
      await page.evaluate(() => (globalThis as unknown as { api: Api }).api.auth.status()),
    ).toMatchObject({ registered: true, locked: true })
    await expectLockedOrganizer(page)
    expect(
      await page.evaluate(
        (password) => (globalThis as unknown as { api: Api }).api.auth.login(password),
        RECOVERED_PASSWORD,
      ),
    ).toEqual({ ok: true })
    await expectSavedShell(page)
    expect(await readState(page)).toEqual(saved)
    await page
      .locator('.sidebar__rail')
      .getByRole('button', { name: /^(Calendar|Kalender)$/ })
      .click()
    await expect(page.locator('.organizer__month-grid thead abbr').first()).toHaveAttribute(
      'title',
      /Sunday|Sonntag/,
    )
    expect(pageErrors).toEqual([])
  } finally {
    await app?.close().catch(() => undefined)
    await rm(dataRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
