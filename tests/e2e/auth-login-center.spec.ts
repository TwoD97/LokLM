import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('.', import.meta.url))
const mainEntry = resolve(dir, '..', '..', 'out', 'main', 'index.js')

test('login prompt is centered and has no in-pane logo', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'loklm-login-'))
  // 1) fresh launch → register a user (creates the vault in userData)
  let app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${userData}`],
    env: { ...process.env, NODE_ENV: 'test' },
  })
  let page = await app.firstWindow()
  await page.getByLabel('Anzeigename').fill('Center Bot')
  const pw = page.locator('input[type="password"]')
  await pw.nth(0).fill('Pass123456')
  await pw.nth(1).fill('Pass123456')
  await page.getByRole('button', { name: 'Konto anlegen' }).click()
  await expect(page.getByRole('heading', { name: 'Wiederherstellungs-Wörter' })).toBeVisible()
  await app.close()

  // 2) relaunch SAME userData → locked, registered → LoginView (the password prompt)
  app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${userData}`],
    env: { ...process.env, NODE_ENV: 'test' },
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  // a single password field + unlock button = the login prompt
  await expect(page.locator('input[type="password"]')).toHaveCount(1)

  await expect(page.locator('.app__mark')).toHaveCount(0)
  await expect(page.locator('.app__brand')).toHaveCount(0)

  // String-form evaluate (matches app.spec.ts) so the e2e tsconfig doesn't need
  // the DOM lib for inline browser globals.
  const m = (await page.evaluate(
    `(() => {
       const r = document.querySelector('main.app > section').getBoundingClientRect()
       return { top: r.top, bottom: r.bottom, h: r.height, vh: window.innerHeight }
     })()`,
  )) as { top: number; bottom: number; h: number; vh: number }
  const center = (m.top + m.bottom) / 2
  const off = Math.abs(center - m.vh / 2) / m.vh
  console.log('LOGIN_CENTER', JSON.stringify({ ...m, center, off: +off.toFixed(3) }))
  await page.screenshot({ path: 'test-results/login-centered.png' })
  await app.close()
  await rm(userData, { recursive: true, force: true })

  expect(off).toBeLessThan(0.12) // genuinely centered (short pane)
})
