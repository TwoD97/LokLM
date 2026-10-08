import { test, expect } from '@playwright/test'

test.describe('download area', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#download')
  })

  test('the #download section renders', async ({ page }) => {
    await expect(page.locator('#download')).toBeVisible()
  })

  test('windows card offers a versioned .exe download', async ({ page }) => {
    const link = page.locator('[data-platform-link="windows"]')
    await expect(link).toBeVisible()
    const href = await link.getAttribute('href')
    expect(href).toMatch(/\/v\d+\.\d+\.\d+\/LokLM-x64\.exe$/)
  })

  test('linux card offers a versioned .run installer', async ({ page }) => {
    const link = page.locator('[data-platform-link="linux"][data-asset-variant="run"]')
    await expect(link).toBeVisible()
    const href = await link.getAttribute('href')
    expect(href).toMatch(/LokLM-Setup-.*\.run$/)
    expect(href).toContain('/v')
  })

  test('linux card at least mentions a .deb option', async ({ page }) => {
    // The .deb variant is newer and its button may still be disabled while
    // the release pipeline produces the artefact — so we only check that the
    // card surfaces something recognisably ".deb", not a live link.
    const card = page.locator('[data-platform="linux"]')
    await expect(card).toBeVisible()
    await expect(card).toContainText(/\.deb/)
  })

  test('macOS card offers a versioned .dmg download on the DE page', async ({ page }) => {
    const link = page.locator('[data-platform-link="macos"]')
    await expect(link).toBeVisible()
    const href = await link.getAttribute('href')
    expect(href).toMatch(/LokLM-mac\.dmg$/)
    expect(href).toContain('/v')
  })

  test('macOS card offers the .dmg on the EN page too', async ({ page }) => {
    await page.goto('/en#download')
    const link = page.locator('[data-platform-link="macos"]')
    await expect(link).toBeVisible()
    expect(await link.getAttribute('href')).toMatch(/LokLM-mac\.dmg$/)
  })

  test('each installer exposes its own filename and full checksum', async ({ page }) => {
    const assets = page.locator('#download [data-asset-file]')
    await expect(assets).toHaveCount(4)
    for (const asset of await assets.all()) {
      await asset.locator('summary').click()
      const code = asset.locator('[data-checksum]')
      await expect(code).toBeVisible()
      expect((await code.textContent())?.trim()).toMatch(/^[a-f0-9]{64}$/i)
      await expect(asset.locator('details p')).toContainText(
        (await asset.getAttribute('data-asset-file'))!,
      )
    }
  })

  test('the card states version number and release date', async ({ page }) => {
    const card = page.locator('[data-download-card]')
    await expect(card).toContainText(/v\d+\.\d+\.\d+/)
    await expect(card).toContainText(/\d{4}-\d{2}-\d{2}/)
  })

  test('a Windows user agent gets the highlight ring on the windows card', async ({ page }) => {
    // fake a Windows browser before any page script runs
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'userAgent', {
        get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      })
    })
    await page.goto('/#download')
    await expect(page.locator('[data-platform="windows"]')).toHaveClass(/ring-2/)
  })
})
