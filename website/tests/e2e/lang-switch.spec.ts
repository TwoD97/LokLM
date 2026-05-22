import { test, expect } from '@playwright/test'

test.describe('language switch', () => {
  test('clicking EN from / navigates to /en', async ({ page }) => {
    await page.goto('/')
    await page.locator('header').locator('a[href="/en"]').click()
    await expect(page).toHaveURL(/\/en\/?$/)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  })

  test('clicking DE from /en navigates back to /', async ({ page }) => {
    await page.goto('/en')
    await page.locator('header').locator('a[href="/"]').click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.locator('html')).toHaveAttribute('lang', 'de')
  })

  test('active locale has aria-current=page in switch', async ({ page }) => {
    await page.goto('/')
    const deLink = page.locator('header').locator('a[href="/"]').last()
    const enLink = page.locator('header').locator('a[href="/en"]')
    await expect(deLink).toHaveAttribute('aria-current', 'page')
    await expect(enLink).not.toHaveAttribute('aria-current', 'page')
  })

  test('imprint exists in both languages', async ({ page }) => {
    await page.goto('/imprint')
    await expect(page.locator('html')).toHaveAttribute('lang', 'de')
    await expect(page.locator('h1')).toContainText('Impressum')

    await page.goto('/en/imprint')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.locator('h1')).toContainText('Imprint')
  })

  test('privacy exists in both languages', async ({ page }) => {
    await page.goto('/privacy')
    await expect(page.locator('html')).toHaveAttribute('lang', 'de')
    await expect(page.locator('h1')).toContainText('Datenschutz')

    await page.goto('/en/privacy')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.locator('h1')).toContainText('Privacy')
  })
})
