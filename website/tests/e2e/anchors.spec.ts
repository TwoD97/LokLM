import { test, expect } from '@playwright/test'

test.describe('anchor navigation', () => {
  test('nav features link scrolls to the features section', async ({ page }) => {
    await page.goto('/')
    await page.locator('header').locator('a[href="#features"]').click()
    await expect(page).toHaveURL(/#features$/)
    const target = page.locator('#features')
    await expect(target).toBeInViewport({ ratio: 0.1 })
  })

  test('nav download link scrolls to the download section', async ({ page }) => {
    await page.goto('/')
    await page.locator('header').locator('a[href="#download"]').click()
    await expect(page).toHaveURL(/#download$/)
    await expect(page.locator('#download')).toBeInViewport({ ratio: 0.1 })
  })

  test('hero primary CTA goes to the download section', async ({ page }) => {
    await page.goto('/')
    await page.locator('.hero__ctas a[href="#download"]').click()
    await expect(page).toHaveURL(/#download$/)
    await expect(page.locator('#download')).toBeInViewport({ ratio: 0.1 })
  })

  test('all expected section ids are present', async ({ page }) => {
    await page.goto('/')
    for (const id of ['features', 'download']) {
      await expect(page.locator(`#${id}`)).toHaveCount(1)
    }
  })
})
