import { test, expect } from '@playwright/test'
import { launchApp } from './helpers/launch'
import { registerVault } from './helpers/seed'

// This UI exercise briefly displays a disposable recovery phrase. Never retain
// automatic captures; the explicit image below is taken only after locked login.
test.use({ trace: 'off', screenshot: 'off', video: 'off' })

test('login prompt is centered and has no in-pane logo', async () => {
  const launched = await launchApp()
  try {
    // Restart from recovery without capturing the phrase. Registration may
    // still schedule background model warmup; cleanup owns its cancellation.
    await registerVault(launched.page, 'Center Bot')
    await launched.restart()
    const { page } = launched
    await expect(page.locator('input[type="password"]')).toHaveCount(1)
    await expect(page.locator('.app__mark')).toHaveCount(0)
    await expect(page.locator('.app__brand')).toHaveCount(0)
    // Select the card itself without coupling to the app root's element type.
    const card = page.locator('.auth-card')
    await expect(card).toBeVisible()
    const height = await page.evaluate<number>('window.innerHeight')
    await expect
      .poll(async () => {
        const current = await card.boundingBox()
        return Math.abs(current!.y + current!.height / 2 - height / 2) / height
      })
      .toBeLessThan(0.12)
    await page.screenshot({ path: test.info().outputPath('login-centered.png') })
  } finally {
    await launched.cleanup()
  }
})
