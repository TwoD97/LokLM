import { test, expect } from '@playwright/test'
import type { Api } from '../../src/preload'
import { launchApp, type LaunchedApp } from './helpers/launch'

test.setTimeout(180_000)
test.use({ trace: 'off', screenshot: 'off', video: 'off' })
let launched: LaunchedApp | undefined

test.beforeEach(async () => {
  launched = await launchApp()
  const page = launched.page
  await page.evaluate(async () => {
    // Settings tests do not need the recovery reveal. Discard its result inside
    // the renderer so recovery words cannot appear in failure captures.
    await (globalThis as unknown as { api: Api }).api.auth.register(
      'Settings fixture',
      'Settings-Fixture-2026!',
      'en',
    )
  })
  await expect
    .poll(
      async () => {
        if (await page.locator('.app-shell').isVisible()) return true
        const open = page.getByRole('button', { name: /Open workspace|Arbeitsbereich.*ffnen/ })
        if (await open.isVisible()) await open.click()
        return page.locator('.app-shell').isVisible()
      },
      { timeout: 30_000 },
    )
    .toBe(true)
})
test.afterEach(async () => {
  await launched?.cleanup()
  launched = undefined
})

async function openSettings() {
  const page = launched!.page
  await page.getByRole('button', { name: /^(Settings|Einstellungen)$/ }).click()
  const dialog = page.getByRole('dialog', { name: /^(Settings|Einstellungen)$/ })
  await expect(dialog).toBeVisible()
  return dialog
}

test('settings modal opens via gear and tabs switch', async () => {
  const dialog = await openSettings()
  await expect(dialog.getByRole('tab', { name: 'Allgemein' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await dialog.getByRole('tab', { name: 'Profil' }).click()
  await expect(dialog.getByRole('tab', { name: 'Profil' })).toHaveAttribute('aria-selected', 'true')
  await dialog.getByRole('tab', { name: 'Erweitert', exact: true }).click()
  await expect(dialog.locator('.settings-advanced-banner')).toBeVisible()
  await launched!.page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('language choice persists after closing and reopening settings', async () => {
  const dialog = await openSettings()
  const english = dialog
    .getByRole('radiogroup', { name: /Interface language|Display language|Anzeigesprache/ })
    .getByRole('radio', { name: 'English', exact: true })
  await english.click()
  await expect(english).toHaveAttribute('aria-checked', 'true')
  await launched!.page.keyboard.press('Escape')
  const reopened = await openSettings()
  await expect(
    reopened
      .getByRole('radiogroup', { name: /Interface language|Display language|Anzeigesprache/ })
      .getByRole('radio', { name: 'English', exact: true }),
  ).toHaveAttribute('aria-checked', 'true')
  await expect(reopened.getByRole('tab', { name: 'General' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
})

test('theme choice persists and applies to the document', async () => {
  const dialog = await openSettings()
  await dialog.getByRole('radio', { name: 'Dunkel', exact: true }).click()
  await expect
    .poll(() =>
      launched!.page.evaluate<string | undefined>('document.documentElement.dataset.theme'),
    )
    .toBe('dark')
  await launched!.page.keyboard.press('Escape')
  const reopened = await openSettings()
  await expect(reopened.getByRole('radio', { name: 'Dunkel', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  )
})
