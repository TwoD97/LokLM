import { test, expect } from '@playwright/test'

test.describe('locale switching', () => {
  test('the EN link in the header takes / to /en', async ({ page }) => {
    await page.goto('/')
    await page.locator('header').locator('a[href="/en"]').click()
    await expect(page).toHaveURL(/\/en\/?$/)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  })

  test('the DE link in the header takes /en back to /', async ({ page }) => {
    await page.goto('/en')
    await page.locator('header').locator('a[href="/"]').click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.locator('html')).toHaveAttribute('lang', 'de')
  })

  test('only the current locale is marked aria-current=page', async ({ page }) => {
    await page.goto('/')
    // the logo is also a[href="/"]; the switcher's DE link comes last
    const deSwitch = page.locator('header').locator('a[href="/"]').last()
    const enSwitch = page.locator('header').locator('a[href="/en"]')
    await expect(deSwitch).toHaveAttribute('aria-current', 'page')
    await expect(enSwitch).not.toHaveAttribute('aria-current', 'page')
  })

  test('the imprint page is available in de and en', async ({ page }) => {
    await page.goto('/imprint')
    await expect(page.locator('html')).toHaveAttribute('lang', 'de')
    await expect(page.locator('h1')).toContainText('Impressum')

    await page.goto('/en/imprint')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.locator('h1')).toContainText('Imprint')
  })

  test('the privacy page is available in de and en', async ({ page }) => {
    await page.goto('/privacy')
    await expect(page.locator('html')).toHaveAttribute('lang', 'de')
    await expect(page.locator('h1')).toContainText('Datenschutz')

    await page.goto('/en/privacy')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.locator('h1')).toContainText('Privacy')
  })
})
