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

// Ordinary workflows use helpers/seed.registerAndUnlock: programmatic auth keeps
// recovery words out of captures while sharing the current warmup selectors.
