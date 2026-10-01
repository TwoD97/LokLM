import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import type { Api } from '../../src/preload'
import { launchApp } from './helpers/launch'

// This spec never displays or returns recovery words. Disable all automatic
// capture too: future auth changes must not put credentials in test artifacts.
test.use({ trace: 'off', screenshot: 'off', video: 'off' })
test.setTimeout(240_000)

const SETTINGS_PANELS = [
  { name: 'General', ready: '.settings-section-head' },
  { name: 'Modules', ready: '.preferences-module-list' },
  { name: 'System & models', ready: '.preferences-system' },
  { name: 'Advanced', ready: '.settings-advanced-banner' },
  { name: 'Profile', ready: '.settings-profile-card' },
  { name: 'About', ready: '.settings-about' },
] as const

function luminance(css: string): number {
  const rgb = css.match(/[\d.]+/g)!.map(Number)
  expect(rgb).toHaveLength(3)
  return rgb.reduce((sum, value, index) => {
    const channel = value / 255
    const linear = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    return sum + linear * [0.2126, 0.7152, 0.0722][index]!
  }, 0)
}

async function assertAvatarContrast(page: Page): Promise<void> {
  // Axe can report clipped circular initials as incomplete. Check the actual
  // browser-computed solid colors too, so unreadable preset colors cannot hide
  // behind that limitation. This checks the rendered consumers, not just helpers.
  const colors = await page
    .locator(
      '.settings-profile-card [data-testid="avatar-initials"], .settings-profile-preset__swatch',
    )
    .evaluateAll((elements) => {
      const browser = globalThis as unknown as {
        getComputedStyle(element: unknown): { color: string; backgroundColor: string }
      }
      return elements.map((element) => {
        const style = browser.getComputedStyle(element)
        return { foreground: style.color, background: style.backgroundColor }
      })
    })
  expect(colors).toHaveLength(7)
  for (const { foreground, background } of colors) {
    const lightness = [luminance(foreground), luminance(background)].sort((a, b) => a - b)
    expect((lightness[1]! + 0.05) / (lightness[0]! + 0.05)).toBeGreaterThanOrEqual(4.5)
  }
}

async function audit(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  // Electron owns one application page; legacy mode runs the same axe rules
  // there instead of opening the extra browser tab used by finishRun().
  // Keep native color-contrast checks enabled (unlike the JSDOM smoke audit).
  const result = await new AxeBuilder({ page })
    .setLegacyMode()
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  const summary = {
    name,
    version: result.testEngine.version,
    violations: result.violations.map(({ id, impact, nodes }) => ({
      id,
      impact,
      targets: nodes.map((node) => node.target),
    })),
    incomplete: result.incomplete.map(({ id, nodes }) => ({
      id,
      targets: nodes.map((node) => node.target),
    })),
    passedRules: result.passes.length,
  }
  // Selectors/rule IDs only: no HTML snapshots, field values or recovery text.
  const path = testInfo.outputPath(`accessibility-${name}.json`)
  await writeFile(path, JSON.stringify(summary, null, 2))
  await testInfo.attach(`accessibility-${name}.json`, {
    path,
    contentType: 'application/json',
  })
  expect.soft(summary.violations, `Accessibility: ${name}`).toEqual([])
}

test('native accessibility: auth, library, organizer and settings in both themes', async () => {
  const testInfo = test.info()
  const launched = await launchApp({ contentSize: { width: 1280, height: 900 } })
  const page = launched.page
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(page.getByRole('heading', { level: 1, name: 'Konto anlegen' })).toBeVisible()
    await audit(page, testInfo, 'registration')

    await page.evaluate(async () => {
      const api = (globalThis as unknown as { api: Api }).api
      // Do not assign/return the result: the renderer does not enter Reveal,
      // and the disposable phrase never crosses the Playwright connection.
      await api.auth.register('Accessibility fixture', 'Synthetic-A11y-2026!', 'en')
      await api.settings.update({
        basic: { language: 'en', startView: 'notes', theme: 'light' },
      })
      const workspace = await api.workspaces.create('Accessibility workspace')
      await api.workspaces.setDefault(workspace.id)
      const now = new Date()
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      await api.organizer.saveNote({
        title: 'Synthetic research note',
        body: 'A local accessibility fixture. No private source material.',
      })
      await api.organizer.saveTask({
        title: 'Review the synthetic note',
        completed: false,
        dueDate: date,
      })
      await api.organizer.saveEvent({
        title: 'Synthetic planning session',
        date,
        startTime: '10:00',
        endTime: '10:30',
        details: 'Review the local accessibility fixture.',
      })
    })
    // Rehydrate the confirmed landing preference; personal tools do not depend
    // on model warmup completing. No model or document download is requested.
    await page.reload()
    await expect(page.locator('.app-shell')).toBeVisible()
    const nav = page.locator('.sidebar__rail')
    const settingsButton = page.getByRole('button', { name: 'Settings', exact: true })

    for (const theme of ['light', 'dark'] as const) {
      await settingsButton.click()
      const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
      await expect(dialog.getByRole('tab', { name: 'General', exact: true })).toBeFocused()
      await dialog
        .getByRole('radio', { name: theme === 'light' ? 'Light' : 'Dark', exact: true })
        .click()
      await expect.poll(() => page.evaluate('document.documentElement.dataset.theme')).toBe(theme)

      // Arrow/Home/End navigation selects the matching tab without sending
      // focus out of the dialog, including before a lazy panel has loaded.
      await dialog.getByRole('tab', { name: 'General', exact: true }).focus()
      await page.keyboard.press('End')
      await expect(dialog.getByRole('tab', { name: 'About', exact: true })).toBeFocused()
      await page.keyboard.press('Home')
      await expect(dialog.getByRole('tab', { name: 'General', exact: true })).toBeFocused()
      await page.keyboard.press('ArrowDown')
      await expect(dialog.getByRole('tab', { name: 'Modules', exact: true })).toBeFocused()

      for (const panel of SETTINGS_PANELS) {
        await dialog.getByRole('tab', { name: panel.name, exact: true }).click()
        await expect(dialog.locator(panel.ready).first()).toBeVisible()
        if (panel.name === 'Profile') await assertAvatarContrast(page)
        await audit(
          page,
          testInfo,
          `${theme}-settings-${panel.name.replaceAll(' ', '-').toLowerCase()}`,
        )
      }
      await dialog.getByRole('button', { name: 'Close', exact: true }).focus()
      await page.keyboard.press('Shift+Tab')
      await expect
        .poll(() =>
          page.evaluate(
            'Boolean(document.querySelector(".settings-modal")?.contains(document.activeElement))',
          ),
        )
        .toBe(true)
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await expect(settingsButton).toBeFocused()

      await nav.getByRole('button', { name: 'Library', exact: true }).click()
      await expect(page.locator('.library')).toBeVisible()
      await expect(
        page.getByRole('heading', { name: 'Accessibility workspace', exact: true }),
      ).toBeVisible()
      await audit(page, testInfo, `${theme}-library-empty`)

      for (const view of ['Notes', 'Calendar', 'To-dos'] as const) {
        await nav.getByRole('button', { name: view, exact: true }).click()
        await expect(
          page.locator('.organizer').getByRole('heading', { level: 1, name: view, exact: true }),
        ).toBeVisible()
        const content =
          view === 'Notes'
            ? '.organizer__note-item'
            : view === 'Calendar'
              ? '.organizer__agenda'
              : '.organizer__tasks'
        await expect(page.locator(content).first()).toBeVisible()
        await audit(page, testInfo, `${theme}-organizer-${view.toLowerCase()}`)
      }
    }

    await page.evaluate(() => (globalThis as unknown as { api: Api }).api.auth.lock())
    await expect(page.getByRole('button', { name: 'Forgot password?', exact: true })).toBeVisible()
    await audit(page, testInfo, 'login')
    await page.getByRole('button', { name: 'Forgot password?', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Reset password', exact: true })).toBeVisible()
    // The recovery entry form is safe to audit empty; never enter any phrase.
    await audit(page, testInfo, 'recovery-empty')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Forgot password?', exact: true })).toBeVisible()
  } finally {
    await launched.cleanup()
  }
})
