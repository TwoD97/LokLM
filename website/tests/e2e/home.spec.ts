import { test, expect } from '@playwright/test'

test.describe('german landing page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('document language is declared as de', async ({ page }) => {
    expect(await page.locator('html').getAttribute('lang')).toBe('de')
  })

  test('hero headline shows the german copy', async ({ page }) => {
    const title = page.locator('h1.hero__title')
    await expect(title).toBeVisible()
    await expect(title).toContainText('Eigene Dokumente')
  })

  test('hero renders exactly three pills', async ({ page }) => {
    await expect(page.locator('.hero__pills .pill')).toHaveCount(3)
  })

  test('header nav offers features, download and github', async ({ page }) => {
    const nav = page.locator('header nav')
    await expect(nav.locator('a[href="#features"]')).toBeVisible()
    await expect(nav.locator('a[href="#download"]')).toBeVisible()
    await expect(nav.locator('a[href="https://github.com/TwoD97/LokLM"]')).toBeVisible()
  })

  test('canonical url is the bare origin', async ({ page }) => {
    expect(await page.locator('link[rel="canonical"]').getAttribute('href')).toBe(
      'https://loklm.com',
    )
  })

  test('alternate links cover de, en and x-default', async ({ page }) => {
    const alternates = await page.locator('link[rel="alternate"]').evaluateAll((nodes) =>
      nodes.map((n) => ({
        hreflang: n.getAttribute('hreflang'),
        href: n.getAttribute('href'),
      })),
    )
    expect(alternates).toContainEqual({ hreflang: 'de', href: 'https://loklm.com' })
    expect(alternates).toContainEqual({ hreflang: 'en', href: 'https://loklm.com/en' })
    expect(alternates).toContainEqual({ hreflang: 'x-default', href: 'https://loklm.com' })
  })

  test('structured data parses as JSON and includes the core types', async ({ page }) => {
    const raw = await page.locator('script[type="application/ld+json"]').allTextContents()
    expect(raw.length).toBeGreaterThanOrEqual(2)
    const types = raw.map((block) => JSON.parse(block)['@type']).sort()
    expect(types).toContain('Organization')
    expect(types).toContain('SoftwareApplication')
  })
})

test.describe('english landing page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en')
  })

  test('document language is declared as en', async ({ page }) => {
    expect(await page.locator('html').getAttribute('lang')).toBe('en')
  })

  test('hero headline shows the english copy', async ({ page }) => {
    await expect(page.locator('h1.hero__title')).toContainText('Query your own documents')
  })

  test('nav link texts are translated', async ({ page }) => {
    const nav = page.locator('header nav')
    await expect(nav.locator('a[href="#features"]')).toHaveText(/Features/)
    await expect(nav.locator('a[href="#download"]')).toHaveText(/Download/)
  })

  test('canonical url is /en without a trailing slash (astro trailingSlash config)', async ({
    page,
  }) => {
    expect(await page.locator('link[rel="canonical"]').getAttribute('href')).toBe(
      'https://loklm.com/en',
    )
  })
})
