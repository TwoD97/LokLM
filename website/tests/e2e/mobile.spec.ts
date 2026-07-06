import { test, expect } from '@playwright/test'

// Executed with the Pixel 7 viewport (412×915) configured in playwright.config.
// Below the sm: breakpoint (< 640 px) the nav links disappear on purpose — the
// design ships no hamburger menu. These tests lock that decision in so a later
// refactor cannot drop the mobile fallback unnoticed.

// WCAG 2.5.5 (AAA) minimum target size; Lighthouse audits the same 44px figure.
const TOUCH_TARGET_PX = 44

test.describe('Pixel 7 layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('runs in a sub-640px viewport', async ({ page }) => {
    expect(page.viewportSize()?.width).toBeLessThan(640)
  })

  test('logo and language switch survive the breakpoint', async ({ page }) => {
    const header = page.locator('header')
    await expect(header.locator('a[href="/"]').first()).toBeVisible() // logo
    await expect(header.locator('a[href="/en"]')).toBeVisible() // EN switch
  })

  test('nav links reserved for desktop are hidden', async ({ page }) => {
    const header = page.locator('header')
    await expect(header.locator('a[href="#features"]')).toBeHidden()
    await expect(header.locator('a[href="#download"]')).toBeHidden()
    await expect(header.locator('a[href="https://github.com/TwoD97/LokLM"]')).toBeHidden()
  })

  test('hero headline and both CTAs are visible in the stacked layout', async ({ page }) => {
    await expect(page.locator('h1.hero__title')).toBeVisible()
    await expect(page.locator('.hero__ctas a[href="#download"]')).toBeVisible()
    await expect(page.locator('.hero__ctas a[href="#how"]')).toBeVisible()
  })

  test('primary CTA measures at least 44×44 css px', async ({ page }) => {
    const box = await page.locator('.hero__ctas a[href="#download"]').boundingBox()
    expect(box, 'cta has a bounding box').not.toBeNull()
    expect(box!.height).toBeGreaterThanOrEqual(TOUCH_TARGET_PX)
    expect(box!.width).toBeGreaterThanOrEqual(TOUCH_TARGET_PX)
  })

  test('all active download links are tall enough to tap (WCAG 2.5.5)', async ({ page }) => {
    // Disabled controls are exempt under WCAG 2.5.5 — the macOS "coming soon"
    // button carries `disabled`, so only real download anchors are measured.
    await page.locator('#download').scrollIntoViewIfNeeded()
    const links = page.locator('#download a[data-platform-link]')
    const total = await links.count()
    expect(total).toBeGreaterThan(0)
    for (let i = 0; i < total; i++) {
      const box = await links.nth(i).boundingBox()
      expect(box, `download link #${i} has a bounding box`).not.toBeNull()
      expect(box!.height, `download link #${i} height`).toBeGreaterThanOrEqual(TOUCH_TARGET_PX)
    }
  })

  test('the three platform cards fall into one column', async ({ page }) => {
    await page.locator('#download').scrollIntoViewIfNeeded()
    const cards = page.locator('[data-platform]')
    await expect(cards).toHaveCount(3)

    const boxes = await Promise.all(Array.from({ length: 3 }, (_, i) => cards.nth(i).boundingBox()))
    // stacked column: every card starts below the one before it
    expect(boxes[0]!.y).toBeLessThan(boxes[1]!.y)
    expect(boxes[1]!.y).toBeLessThan(boxes[2]!.y)
  })

  test('tapping the CTA brings #download into view', async ({ page }) => {
    await page.locator('.hero__ctas a[href="#download"]').click()
    await expect(page).toHaveURL(/#download$/)
    await expect(page.locator('#download')).toBeInViewport({ ratio: 0.1 })
  })

  test('the locale can still be switched from the mobile header', async ({ page }) => {
    await page.locator('header').locator('a[href="/en"]').click()
    await expect(page).toHaveURL(/\/en\/?$/)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.locator('h1.hero__title')).toContainText('Query your own documents')
  })

  test('the page never scrolls sideways', async ({ page }) => {
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    // allow 1px of sub-pixel rounding on scaled (retina) viewports
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1)
  })
})
