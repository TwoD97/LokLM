import { test, expect } from '@playwright/test'

test('DE home: the first use-case card points at the lawyer persona page', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.cases__link').first()).toHaveAttribute('href', '/einsatz/anwalt')
})

test('EN home: use-case cards point into /en/use-cases/', async ({ page }) => {
  await page.goto('/en')
  await expect(page.locator('.cases__link').first()).toHaveAttribute('href', /\/en\/use-cases\//)
})

test('DE home: the architecture CTA points at the pillar page', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('a.arch__cta')).toHaveAttribute('href', '/architektur')
})
