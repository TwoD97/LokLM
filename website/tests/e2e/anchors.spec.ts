import { test, expect } from '@playwright/test'

test.describe('in-page anchors', () => {
  test('header link #features lands on the features section', async ({ page }) => {
    await page.goto('/')
    await page.locator('header').locator('a[href="#features"]').click()
    await expect(page).toHaveURL(/#features$/)
    await expect(page.locator('#features')).toBeInViewport({ ratio: 0.1 })
  })

  test('header link #download lands on the download section', async ({ page }) => {
    await page.goto('/')
    await page.locator('header').locator('a[href="#download"]').click()
    await expect(page).toHaveURL(/#download$/)
    await expect(page.locator('#download')).toBeInViewport({ ratio: 0.1 })
  })

  test('the primary hero CTA also targets #download', async ({ page }) => {
    await page.goto('/')
    await page.locator('.hero__ctas a[href="#download"]').click()
    await expect(page).toHaveURL(/#download$/)
    await expect(page.locator('#download')).toBeInViewport({ ratio: 0.1 })
  })

  test('each anchor target id exists exactly once', async ({ page }) => {
    await page.goto('/')
    for (const id of ['features', 'download']) {
      await expect(page.locator(`#${id}`)).toHaveCount(1)
    }
  })
})
