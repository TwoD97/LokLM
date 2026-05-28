import { test, expect } from '@playwright/test'

test('use-case cards link to persona pages (DE)', async ({ page }) => {
  await page.goto('/')
  const firstCard = page.locator('.cases__link').first()
  await expect(firstCard).toHaveAttribute('href', '/einsatz/anwalt')
})

test('use-case cards link to persona pages (EN)', async ({ page }) => {
  await page.goto('/en')
  const firstCard = page.locator('.cases__link').first()
  await expect(firstCard).toHaveAttribute('href', /\/en\/use-cases\//)
})

test('architecture section links to the pillar (DE)', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('a.arch__cta')).toHaveAttribute('href', '/architektur')
})
