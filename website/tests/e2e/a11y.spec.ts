import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// runs axe-core against each page in both locales. fails on any
// 'serious' or 'critical' WCAG 2.1 AA violation.

async function runAxe(page: Page) {
  return (
    new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      // decorative content (aria-hidden) is intentionally subtle and not
      // exposed to assistive tech; skip it from color-contrast checks.
      .exclude('[aria-hidden="true"]')
      .analyze()
  )
}

function severe(results: Awaited<ReturnType<typeof runAxe>>) {
  return results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
}

const pages: Array<{ url: string; label: string }> = [
  { url: '/', label: 'home (de)' },
  { url: '/en', label: 'home (en)' },
  { url: '/imprint', label: 'imprint (de)' },
  { url: '/en/imprint', label: 'imprint (en)' },
  { url: '/privacy', label: 'privacy (de)' },
  { url: '/en/privacy', label: 'privacy (en)' },
]

for (const { url, label } of pages) {
  test(`a11y: ${label} has no serious/critical WCAG 2.1 AA violations`, async ({ page }) => {
    await page.goto(url)
    const results = await runAxe(page)
    const bad = severe(results)
    if (bad.length > 0) {
      // surface helpful diagnostics on failure
      console.log(
        `axe violations on ${label}:\n` +
          bad
            .map(
              (v) =>
                `  [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length} node(s)) — ${v.helpUrl}`,
            )
            .join('\n'),
      )
    }
    expect(bad, `${bad.length} serious/critical a11y issues on ${label}`).toEqual([])
  })
}
