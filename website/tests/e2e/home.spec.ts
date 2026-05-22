import { test, expect } from '@playwright/test'

test.describe('home (de)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('html lang is de', async ({ page }) => {
    const lang = await page.locator('html').getAttribute('lang')
    expect(lang).toBe('de')
  })

  test('hero title contains the german wording', async ({ page }) => {
    await expect(page.locator('h1.hero__title')).toBeVisible()
    await expect(page.locator('h1.hero__title')).toContainText('Eigene Dokumente')
  })

  test('three hero pills are rendered', async ({ page }) => {
    const pills = page.locator('.hero__pills .pill')
    await expect(pills).toHaveCount(3)
  })

  test('nav exposes features, download, github links', async ({ page }) => {
    const nav = page.locator('header nav')
    await expect(nav.locator('a[href="#features"]')).toBeVisible()
    await expect(nav.locator('a[href="#download"]')).toBeVisible()
    await expect(nav.locator('a[href="https://github.com/TwoD97/LokLM"]')).toBeVisible()
  })

  test('canonical link points to the bare site url', async ({ page }) => {
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href')
    expect(canonical).toBe('https://loklm.com')
  })

  test('hreflang alternates declare both locales + x-default', async ({ page }) => {
    const langs = await page.locator('link[rel="alternate"]').evaluateAll((nodes) =>
      nodes.map((n) => ({
        hreflang: n.getAttribute('hreflang'),
        href: n.getAttribute('href'),
      })),
    )
    expect(langs).toContainEqual({ hreflang: 'de', href: 'https://loklm.com' })
    expect(langs).toContainEqual({ hreflang: 'en', href: 'https://loklm.com/en' })
    expect(langs).toContainEqual({ hreflang: 'x-default', href: 'https://loklm.com' })
  })

  test('JSON-LD blocks parse and declare expected @type', async ({ page }) => {
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents()
    expect(blocks.length).toBeGreaterThanOrEqual(2)
    const types = blocks.map((b) => JSON.parse(b)['@type']).sort()
    expect(types).toContain('Organization')
    expect(types).toContain('SoftwareApplication')
  })
})

test.describe('home (en)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en')
  })

  test('html lang is en', async ({ page }) => {
    const lang = await page.locator('html').getAttribute('lang')
    expect(lang).toBe('en')
  })

  test('hero title contains the english wording', async ({ page }) => {
    await expect(page.locator('h1.hero__title')).toContainText('Query your own documents')
  })

  test('nav labels are localised to english', async ({ page }) => {
    const nav = page.locator('header nav')
    await expect(nav.locator('a[href="#features"]')).toHaveText(/Features/)
    await expect(nav.locator('a[href="#download"]')).toHaveText(/Download/)
  })

  test('canonical points to /en (no trailing slash per astro config)', async ({ page }) => {
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href')
    expect(canonical).toBe('https://loklm.com/en')
  })
})
