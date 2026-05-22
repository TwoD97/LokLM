import { test, expect } from '@playwright/test'

// visual regression baselines. first run creates the .png reference, subsequent
// runs diff against it. layout-sensitive — bump the baseline when the design
// changes intentionally.

test.describe('visual regression', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('home (de) hero', async ({ page }) => {
    await page.goto('/')
    await page.locator('h1.hero__title').waitFor()
    // freeze animations to avoid flake on the fade-in-up keyframes
    await page.addStyleTag({
      content: `*, *::before, *::after { animation: none !important; transition: none !important; }`,
    })
    await expect(page.locator('.hero')).toHaveScreenshot('hero-de.png', {
      maxDiffPixelRatio: 0.02,
    })
  })

  test('home (en) hero', async ({ page }) => {
    await page.goto('/en')
    await page.locator('h1.hero__title').waitFor()
    await page.addStyleTag({
      content: `*, *::before, *::after { animation: none !important; transition: none !important; }`,
    })
    await expect(page.locator('.hero')).toHaveScreenshot('hero-en.png', {
      maxDiffPixelRatio: 0.02,
    })
  })

  test('download card', async ({ page }) => {
    await page.goto('/#download')
    await page.locator('[data-download-card]').scrollIntoViewIfNeeded()
    await page.addStyleTag({
      content: `*, *::before, *::after { animation: none !important; transition: none !important; }`,
    })
    await expect(page.locator('[data-download-card]')).toHaveScreenshot('download-card.png', {
      maxDiffPixelRatio: 0.02,
    })
  })

  test('footer', async ({ page }) => {
    await page.goto('/')
    const footer = page.locator('footer').first()
    await footer.scrollIntoViewIfNeeded()
    await page.addStyleTag({
      content: `*, *::before, *::after { animation: none !important; transition: none !important; }`,
    })
    await expect(footer).toHaveScreenshot('footer.png', { maxDiffPixelRatio: 0.02 })
  })
})
