import { test, expect } from '@playwright/test'
import { launchApp, type LaunchedApp } from './helpers/launch'

let launched: LaunchedApp

test.beforeEach(async () => {
  launched = await launchApp()
})

test.afterEach(async () => {
  await launched.cleanup()
})

test('app starts und zeigt registrierungs-view bei frischem userData', async () => {
  const heading = launched.page.getByRole('heading', { level: 1, name: 'Konto anlegen' })
  await expect(heading).toBeVisible()
})

test('titelbar zeigt LokLM brand', async () => {
  // brand taucht sowohl in der titlebar als auch im content-header auf
  const brand = launched.page.getByText('LokLM').first()
  await expect(brand).toBeVisible()
})

// weitere specs als vorlage:
//
// test('registrierung happy-path' , async () => {
//   await launched.page.getByLabel('Anzeigename').fill('Dominik')
//   await launched.page.getByLabel('Passwort').fill('Test12345!')
//   await launched.page.getByLabel('Passwort bestätigen').fill('Test12345!')
//   await launched.page.getByRole('button' , { name: 'Registrieren' }).click()
//   await expect(launched.page.getByText(/passphrase/i)).toBeVisible()
// })
