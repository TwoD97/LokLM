import { test, expect } from '@playwright/test'

for (const locale of [
  {
    home: '/',
    guide: '/blog/pdf-mit-ki-quellen-pruefen',
    translation: '/en/blog/pdf-ai-source-checking',
    business: '/einsatz/unternehmen',
    hardware: '/blog/lokale-ki-4gb-vram',
  },
  {
    home: '/en',
    guide: '/en/blog/pdf-ai-source-checking',
    translation: '/blog/pdf-mit-ki-quellen-pruefen',
    business: '/en/use-cases/business',
    hardware: '/en/blog/local-ai-4gb-vram',
  },
]) {
  test(`${locale.home}: discover a guide and keep the article when switching language`, async ({
    page,
  }) => {
    await page.goto(locale.home)
    await page.locator('#guides h3 a').first().click()
    await expect(page).toHaveURL(new RegExp(`${locale.guide}$`))
    await page.locator('header').locator(`a[href="${locale.translation}"]`).click()
    await expect(page).toHaveURL(new RegExp(`${locale.translation}$`))
    await expect(page.locator('article h1')).toBeVisible()
  })

  test(`${locale.home}: business visitors reach a concrete workflow`, async ({ page }) => {
    await page.goto(locale.home)
    await page.locator(`.cases__link[href="${locale.business}"]`).click()
    await expect(page).toHaveURL(new RegExp(`${locale.business}$`))
    await expect(page.locator('.workflow li')).toHaveCount(3)
    await expect(page.locator('.workflow blockquote')).toBeVisible()
    await page.locator('.cluster__faq summary').first().click()
    await expect(page.locator('.cluster__faq details').first()).toContainText(
      locale.home === '/' ? 'zentrale Rollenverwaltung' : 'centralized roles',
    )
  })

  test(`${locale.home}: hardware guidance is available before choosing an installer`, async ({
    page,
  }) => {
    await page.goto(`${locale.home}#download`)
    await page.locator('#download-fit-title a').click()
    await expect(page).toHaveURL(new RegExp(`${locale.hardware}$`))
    await expect(page.locator('h1')).toContainText('4 GB')
  })
}

test('mobile navigation works without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 360, height: 800 },
  })
  try {
    const page = await context.newPage()
    await page.goto('http://localhost:4321/')
    await page.locator('[data-mobile-menu] summary').click()
    await page.locator('[data-mobile-menu] a[href="/blog"]').click()
    await expect(page).toHaveURL(/\/blog$/)
    await expect(page.locator('h1')).toBeVisible()
  } finally {
    await context.close()
  }
})

test('an iPad desktop user agent does not recommend the macOS installer', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgentData', { get: () => undefined })
    Object.defineProperty(navigator, 'userAgent', {
      get: () =>
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
    })
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 })
  })
  await page.goto('/')
  await expect(page.locator('[data-detected-badge]:visible')).toHaveCount(0)
})

test('keyboard users can skip the navigation and continue inside the content', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.press('Tab')
  const skip = page.locator('a[href="#main-content"]')
  await expect(skip).toBeFocused()
  await expect(skip).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.locator('#main-content')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.locator('.hero__ctas a').first()).toBeFocused()
})

for (const url of ['/blog/pdf-mit-ki-quellen-pruefen', '/en/blog/pdf-ai-source-checking']) {
  test(`${url}: narrow-screen tables remain accessible by keyboard`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto(url)
    const region = page.locator('.responsive-table').first()
    await expect(region).toHaveAttribute('role', 'region')
    await expect(region).toHaveAttribute('aria-label', /Tabelle|Table/)
    expect(await region.getByRole('columnheader').count()).toBeGreaterThan(0)
    const box = await region.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(320)
    expect(await region.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
    await region.focus()
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
  })
}

test('long German audience headings fit a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto('/einsatz/unternehmen')
  const bounds = await page.locator('h1').evaluate((heading) => {
    const range = document.createRange()
    range.selectNodeContents(heading)
    const rect = range.getBoundingClientRect()
    return { left: rect.left, right: rect.right }
  })
  expect(bounds.left).toBeGreaterThanOrEqual(0)
  expect(bounds.right).toBeLessThanOrEqual(320)
})
