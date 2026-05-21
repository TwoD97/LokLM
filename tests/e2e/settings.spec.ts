import { test, expect } from '@playwright/test'
import { launchApp, type LaunchedApp } from './helpers/launch'

// Settings happy-path e2e:
// - Open modal via gear, verify default tab + tab-switching.
// - Verify Esc closes the modal.
// - Verify the basic language toggle persists across modal close/reopen.
//
// Auth pattern mirrors app.spec.ts: fresh userData lands the user in the
// registration view. We register, acknowledge the recovery words, and land in
// the unlocked shell (which renders the Settings gear in the title bar).

let launched: LaunchedApp

async function registerAndUnlock(launched: LaunchedApp): Promise<void> {
  const { page } = launched

  // Wait for the registration view to render (mirrors app.spec.ts heuristic).
  await expect(page.getByRole('heading', { level: 1, name: 'Konto anlegen' })).toBeVisible()

  await page.getByLabel('Anzeigename').fill('E2E Tester')
  await page.getByLabel('Passwort', { exact: true }).fill('Test12345!')
  await page.getByLabel('Passwort wiederholen').fill('Test12345!')
  await page.getByRole('button', { name: 'Konto anlegen' }).click()

  // The reveal step shows the recovery words. Confirm + continue to unlocked.
  await expect(page.getByRole('heading', { name: 'Wiederherstellungs-Wörter' })).toBeVisible()
  await page.getByLabel('Ich habe die 18 Wörter sicher notiert.').check()
  await page.getByRole('button', { name: 'Weiter' }).click()

  // The unlocked shell renders the Settings gear in the titlebar.
  await expect(page.locator('button[aria-label="Settings"]')).toBeVisible()
}

test.beforeEach(async () => {
  launched = await launchApp()
  await registerAndUnlock(launched)
})

test.afterEach(async () => {
  await launched.cleanup()
})

test('settings modal opens via gear and tabs switch', async () => {
  const { page } = launched

  await page.locator('button[aria-label="Settings"]').click()
  await expect(page.locator('.settings-modal')).toBeVisible()
  await expect(page.locator('.settings-tab--active')).toHaveText('Basic')

  await page.locator('.settings-tab', { hasText: 'Profile' }).click()
  await expect(page.locator('.settings-tab--active')).toHaveText('Profile')

  await page.locator('.settings-tab', { hasText: 'Advanced' }).click()
  await expect(page.locator('.settings-advanced-banner')).toBeVisible()

  // close via Esc
  await page.keyboard.press('Escape')
  await expect(page.locator('.settings-modal')).toBeHidden()
})

test('basic language toggle persists', async () => {
  const { page } = launched

  await page.locator('button[aria-label="Settings"]').click()
  // Click the English radio's label.
  await page.locator('label:has-text("English") input[type="radio"]').click()
  await page.keyboard.press('Escape')

  // reopen — selection persists.
  await page.locator('button[aria-label="Settings"]').click()
  const englishChecked = await page
    .locator('label:has-text("English") input[type="radio"]')
    .isChecked()
  expect(englishChecked).toBe(true)
})
