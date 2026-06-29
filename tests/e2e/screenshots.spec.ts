import { test, expect, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchApp, type LaunchedApp } from './helpers/launch'
import { capture } from './helpers/screenshots'
import { registerAndUnlock, createWorkspace, importAndIndex } from './helpers/seed'

/**
 * Website screenshot harness — automates (and extends) website/screenshots-checklist.md.
 * Launches the BUILT app at 1400×900 / device-scale-factor 2 (the checklist's 2× DPR),
 * seeds a demo vault, drives every feature view, and writes WebP captures straight
 * into website/public/screenshots/.
 *
 * Run: `pnpm build && npx playwright test tests/e2e/screenshots.spec.ts --config tests/e2e/playwright.config.ts`
 * Requires the tier models in ./models (the unpackaged build's model dir) — the
 * content captures (chat answer, translate, rewrite, quiz) are empty without them.
 * Each capture is isolated: a view that has no model / times out is logged and
 * skipped, so the run still produces every other shot.
 */

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const fx = (name: string): string => resolve(__dirname, 'fixtures', name)
const FIXTURES = [
  fx('Attention Is All You Need.pdf'),
  fx('cs-fundamentals.md'),
  fx('project-notes.md'),
]

let launched: LaunchedApp

test.beforeEach(async () => {
  launched = await launchApp({
    extraArgs: ['--force-device-scale-factor=2'],
    contentSize: { width: 1400, height: 900 },
  })
})

test.afterEach(async () => {
  await launched.cleanup()
})

/** Force dark (the LokLM default; a CI box may prefer light). No DOM lib in the
 *  Node tsconfig, so reach window/document via a cast on globalThis. */
async function forceDark(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = globalThis as unknown as {
      api?: { settings?: { set?: (s: unknown) => unknown } }
      document?: { documentElement: { dataset: Record<string, string> } }
    }
    try {
      g.api?.settings?.set?.({ basic: { theme: 'dark' } })
    } catch {
      /* settings api shape may differ — the dataset fallback still forces dark */
    }
    if (g.document) g.document.documentElement.dataset.theme = 'dark'
  })
}

/** Pin the sidebar open so captures show the document tree / nav labels. */
async function pinSidebar(page: Page): Promise<void> {
  const pin = page.getByRole('button', { name: /pin|anheften|fixieren/i }).first()
  await pin.click({ timeout: 4_000 }).catch(() => undefined)
}

async function goto(page: Page, name: RegExp | string): Promise<void> {
  await page.getByRole('button', { name }).first().click({ timeout: 8_000 })
  await page.waitForTimeout(600)
}

/** Run one capture in isolation — log + swallow failures so the run continues. */
async function shot(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`  ✓ ${label}`)
  } catch (e) {
    console.log(`  ✗ ${label} — ${(e as Error).message.split('\n')[0]}`)
  }
}

// @screenshots — tagged so the normal `test:e2e`/CI run skips it (it is heavy:
// ~minutes, needs the tier models). Run on demand with `pnpm screenshots`.
test('@screenshots capture website screenshots for every feature view', async () => {
  test.setTimeout(15 * 60_000)
  const { page } = launched

  await registerAndUnlock(page)
  const workspaceId = await createWorkspace(page, 'Demo')
  const imported = await importAndIndex(page, workspaceId, FIXTURES)
  console.log(`seeded ${imported}/${FIXTURES.length} docs into workspace ${workspaceId}`)

  // Re-render so the renderer picks up the API-created workspace + indexed docs.
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByRole('button', { name: 'Library' })).toBeVisible({ timeout: 120_000 })
  await forceDark(page)
  await pinSidebar(page)

  // --- Library / vault ---
  await shot('step1-import + feature-library + deepdive-vault', async () => {
    await goto(page, 'Library')
    await page.waitForTimeout(1_000)
    await capture(page, 'step1-import')
    await capture(page, 'feature-library')
    await capture(page, 'deepdive-vault')
  })

  // --- Chat: ask input (step2), then a real answer + citation (hero/step3/deepdive) ---
  await shot('chat captures', async () => {
    await goto(page, 'Chat')
    const input = page.getByRole('textbox').first()
    await input.fill('What is the difference between an interpreter and a compiler?')
    await page.waitForTimeout(400)
    await capture(page, 'step2-ask') // mid-typing, before send

    await input.press('Enter')
    // Wait for a citation pill to render (the answer is grounded). Long: iGPU prefill.
    const citation = page.locator('a.citation-chip, a[href^="cite:"]').first()
    await citation.waitFor({ state: 'visible', timeout: 8 * 60_000 })
    await page.waitForTimeout(1_500) // let streaming settle
    await capture(page, 'hero-chat')
    await capture(page, 'deepdive-citation', { locator: citation, pad: 24 })

    // step3-verify: open the cited passage.
    await citation.click().catch(() => undefined)
    await page.waitForTimeout(1_200)
    await capture(page, 'step3-verify')
  })

  // --- Quiz: the create dialog (doc selection) — fast, no LLM generation needed ---
  await shot('feature-quiz', async () => {
    await goto(page, 'Quiz')
    await page
      .getByRole('button', { name: /create|generate|neu|erstellen|quiz/i })
      .first()
      .click({ timeout: 8_000 })
    await page.waitForTimeout(800)
    await capture(page, 'feature-quiz')
    await page
      .getByRole('button', { name: /cancel|abbrechen|schließen/i })
      .first()
      .click()
      .catch(() => undefined)
  })

  // --- Translation: text → translate (needs MADLAD; falls back to the input UI) ---
  await shot('feature-translate', async () => {
    await goto(page, 'Translation')
    const src = page.getByRole('textbox').first()
    await src.fill('An interpreter executes source code directly, statement by statement.')
    await page
      .getByRole('button', { name: /translate|übersetzen/i })
      .first()
      .click({ timeout: 8_000 })
      .catch(() => undefined)
    await page.waitForTimeout(6_000)
    await capture(page, 'feature-translate')
  })

  // --- Writing: text → rewrite (needs the LLM; falls back to the input UI) ---
  await shot('feature-writing', async () => {
    await goto(page, 'Write')
    const src = page.getByRole('textbox').first()
    await src.fill(
      'the interpreter it runs the code line by line and its kinda slow but easy to debug',
    )
    await page
      .getByRole('button', { name: /rewrite|umschreiben|verbessern/i })
      .first()
      .click({ timeout: 8_000 })
      .catch(() => undefined)
    await page.waitForTimeout(20_000)
    await capture(page, 'feature-writing')
  })

  // --- Transcription: the entry UI (no audio needed for the capture) ---
  await shot('feature-transcribe', async () => {
    await goto(page, 'Transcription')
    await page.waitForTimeout(800)
    await capture(page, 'feature-transcribe')
  })

  // --- Offline / settings ---
  await shot('deepdive-offline', async () => {
    await page
      .getByRole('button', { name: /settings|einstellungen/i })
      .first()
      .click({ timeout: 8_000 })
    await page.waitForTimeout(800)
    await capture(page, 'deepdive-offline')
  })
})
