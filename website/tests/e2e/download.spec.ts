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

  test('linux card links to an .AppImage asset', async ({ page }) => {
    const link = page.locator('[data-platform-link="linux"]')
    await expect(link).toBeVisible()
    const href = await link.getAttribute('href')
    expect(href).toMatch(/\.AppImage$/)
  })

  test('macOS card shows the coming-soon button (DE)', async ({ page }) => {
    const card = page.locator('[data-platform="macos"]')
    await expect(card).toBeVisible()
    await expect(card.locator('button')).toBeDisabled()
    await expect(card.locator('button')).toContainText(/Bald verfügbar/)
  })

  test('macOS card shows the coming-soon button (EN)', async ({ page }) => {
    await page.goto('/en#download')
    const card = page.locator('[data-platform="macos"]')
    await expect(card.locator('button')).toContainText(/Coming soon/)
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
