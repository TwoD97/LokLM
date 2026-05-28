import { test, expect } from '@playwright/test'

test.describe('download section', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#download')
  })

  test('section is anchored and visible', async ({ page }) => {
    await expect(page.locator('#download')).toBeVisible()
  })

  test('windows card links to a .exe asset', async ({ page }) => {
    const link = page.locator('[data-platform-link="windows"]')
    await expect(link).toBeVisible()
    const href = await link.getAttribute('href')
    expect(href).toMatch(/LokLM-Setup-.*\.exe$/)
    expect(href).toContain('/v')
  })

  test('linux card links to a .run installer asset', async ({ page }) => {
    const link = page.locator('[data-platform-link="linux"]')
    await expect(link).toBeVisible()
    const href = await link.getAttribute('href')
    expect(href).toMatch(/LokLM-Setup-.*\.run$/)
    expect(href).toContain('/v')
  })

  test('macOS card links to a .dmg asset (DE)', async ({ page }) => {
    const link = page.locator('[data-platform-link="macos"]')
    await expect(link).toBeVisible()
    const href = await link.getAttribute('href')
    expect(href).toMatch(/LokLM-mac\.dmg$/)
    expect(href).toContain('/v')
  })

  test('macOS card links to a .dmg asset (EN)', async ({ page }) => {
    await page.goto('/en#download')
    const link = page.locator('[data-platform-link="macos"]')
    await expect(link).toBeVisible()
    expect(await link.getAttribute('href')).toMatch(/LokLM-mac\.dmg$/)
  })

  test('checksum block renders the sha256 of the primary asset', async ({ page }) => {
    const code = page.locator('#download code.mono')
    await expect(code).toBeVisible()
    const text = (await code.textContent())?.trim() ?? ''
    expect(text).toMatch(/^[a-f0-9]{64}$/i)
  })

  test('version and release date are present', async ({ page }) => {
    const card = page.locator('[data-download-card]')
    await expect(card).toContainText(/v\d+\.\d+\.\d+/)
    await expect(card).toContainText(/\d{4}-\d{2}-\d{2}/)
  })

  test('OS detection ring is applied to the windows card on a Windows UA', async ({
    page,
    context,
  }) => {
    await context.setExtraHTTPHeaders({})
    // emulate a Windows UA via override
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'userAgent', {
        get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      })
    })
    await page.goto('/#download')
    const card = page.locator('[data-platform="windows"]')
    await expect(card).toHaveClass(/ring-2/)
  })
})
