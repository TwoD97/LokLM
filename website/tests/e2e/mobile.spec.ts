import { test, expect } from '@playwright/test'

// runs against the Pixel 7 viewport (412×915) declared in playwright.config.
// nav links under sm: (< 640 px) are hidden by design — there is no hamburger.
// these tests pin the design choice so a refactor cannot silently remove the
// fallback path.

const MIN_TOUCH_TARGET = 44 // WCAG 2.5.5 (AAA) — also Lighthouse target-size audit

test.describe('mobile (Pixel 7)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('viewport is mobile-sized', async ({ page }) => {
    const size = page.viewportSize()
    expect(size?.width).toBeLessThan(640)
  })

  test('logo + LangSwitch remain visible', async ({ page }) => {
    const header = page.locator('header')
    await expect(header.locator('a[href="/"]').first()).toBeVisible() // logo
    await expect(header.locator('a[href="/en"]')).toBeVisible() // lang switch EN
  })

  test('desktop-only nav links are hidden on mobile', async ({ page }) => {
    const header = page.locator('header')
    await expect(header.locator('a[href="#features"]')).toBeHidden()
    await expect(header.locator('a[href="#download"]')).toBeHidden()
    await expect(header.locator('a[href="https://github.com/TwoD97/LokLM"]')).toBeHidden()
  })

  test('hero title and CTAs render in stacked layout', async ({ page }) => {
    await expect(page.locator('h1.hero__title')).toBeVisible()
    await expect(page.locator('.hero__ctas a[href="#download"]')).toBeVisible()
    await expect(page.locator('.hero__ctas a[href="#how"]')).toBeVisible()
  })

  test('hero primary CTA is a sufficient touch target (≥44×44 css px)', async ({ page }) => {
    const cta = page.locator('.hero__ctas a[href="#download"]')
    const box = await cta.boundingBox()
    expect(box, 'cta has a bounding box').not.toBeNull()
    expect(box!.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
    expect(box!.width).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
  })

  test('enabled download links meet touch-target on mobile (WCAG 2.5.5)', async ({ page }) => {
    // WCAG 2.5.5 exempts disabled controls — macOS "coming soon" button has
    // `disabled` and is not tappable, so we only check the live download links.
    await page.locator('#download').scrollIntoViewIfNeeded()
    const links = page.locator('#download a[data-platform-link]')
    const count = await links.count()
    expect(count).toBeGreaterThan(0)
    for (let i = 0; i < count; i++) {
      const el = links.nth(i)
      const box = await el.boundingBox()
      expect(box, `download link #${i} has a bounding box`).not.toBeNull()
      expect(box!.height, `download link #${i} height`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
    }
  })

  test('download cards stack to a single column on mobile', async ({ page }) => {
    await page.locator('#download').scrollIntoViewIfNeeded()
    const cards = page.locator('[data-platform]')
    await expect(cards).toHaveCount(3)

    const boxes = await Promise.all(Array.from({ length: 3 }, (_, i) => cards.nth(i).boundingBox()))
    // single-column => each card y is below the previous (no overlap on x)
    expect(boxes[0]!.y).toBeLessThan(boxes[1]!.y)
    expect(boxes[1]!.y).toBeLessThan(boxes[2]!.y)
  })

  test('anchor CTA scrolls to download section', async ({ page }) => {
    await page.locator('.hero__ctas a[href="#download"]').click()
    await expect(page).toHaveURL(/#download$/)
    await expect(page.locator('#download')).toBeInViewport({ ratio: 0.1 })
  })

  test('language switch still works on mobile', async ({ page }) => {
    await page.locator('header').locator('a[href="/en"]').click()
    await expect(page).toHaveURL(/\/en\/?$/)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.locator('h1.hero__title')).toContainText('Query your own documents')
  })

  test('no horizontal overflow on the document body', async ({ page }) => {
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    // 1 px slack for sub-pixel rounding on retina-scaled viewports
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1)
  })
})
