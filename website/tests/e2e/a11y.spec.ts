import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// Sweeps every indexable page in both locales with axe-core and fails the
// suite as soon as a WCAG 2.1 AA rule reports a 'serious' or 'critical' hit.

async function auditPage(page: Page) {
  return (
    new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      // aria-hidden nodes are purely decorative and never reach assistive
      // tech; their deliberately subtle styling would trip color-contrast.
      .exclude('[aria-hidden="true"]')
      .analyze()
  )
}

const severeOnly = (results: Awaited<ReturnType<typeof auditPage>>) =>
  results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')

const targets: Array<{ url: string; label: string }> = [
  { url: '/', label: 'home (de)' },
  { url: '/en', label: 'home (en)' },
  { url: '/imprint', label: 'imprint (de)' },
  { url: '/en/imprint', label: 'imprint (en)' },
  { url: '/privacy', label: 'privacy (de)' },
  { url: '/en/privacy', label: 'privacy (en)' },
]

for (const { url, label } of targets) {
  test(`axe audit: ${label} is free of serious/critical WCAG 2.1 AA violations`, async ({
    page,
  }) => {
    await page.goto(url)
    const findings = severeOnly(await auditPage(page))
    if (findings.length > 0) {
      // print rule ids + help links so the failure is actionable from CI logs
      console.log(
        `axe violations on ${label}:\n` +
          findings
            .map(
              (v) =>
                `  [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length} node(s)) — ${v.helpUrl}`,
            )
            .join('\n'),
      )
    }
    expect(findings, `${findings.length} serious/critical a11y issues on ${label}`).toEqual([])
  })
}
