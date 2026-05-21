/* global window, document */
// Drives the built Electron app through register -> import -> chat -> source-viewer
// and captures the seven screenshots the landing page needs. Saves PNGs to
// tests/e2e/screenshots/output/, then ffmpeg-converts to webp (main + @1x) into
// website/public/screenshots/. Run with `node scripts/capture-screenshots.mjs`
// after `pnpm build`. The Electron window is visible by default — watch it run.

import { _electron as electron } from '@playwright/test'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const mainEntry = join(repoRoot, 'out', 'main', 'index.js')
const pdfPath = join(repoRoot, 'tests', 'e2e', 'fixtures', 'Attention Is All You Need.pdf')
const outDir = join(repoRoot, 'tests', 'e2e', 'screenshots', 'output')
const finalDir = join(repoRoot, 'website', 'public', 'screenshots')

// Scenes the landing page references. Targets are the rendered display dims
// from Hero.astro / HowItWorks.astro / FeatureDeepDives.astro.
const SCENES = [
  { name: 'hero-chat', target: [1400, 900] },
  { name: 'step1-import', target: [1200, 800] },
  { name: 'step2-ask', target: [1200, 800] },
  { name: 'step3-verify', target: [1200, 800] },
  { name: 'deepdive-citation', target: [1200, 800] },
  { name: 'deepdive-vault', target: [1200, 800] },
  { name: 'deepdive-offline', target: [1200, 800] },
]

function fail(msg) {
  console.error(`\x1b[31m✗ ${msg}\x1b[0m`)
  process.exit(1)
}

if (!existsSync(mainEntry)) fail(`Built app missing at ${mainEntry}. Run \`pnpm build\` first.`)
if (!existsSync(pdfPath)) fail(`Fixture missing at ${pdfPath}.`)

await mkdir(outDir, { recursive: true })
await mkdir(finalDir, { recursive: true })

const userDataDir = await mkdtemp(join(tmpdir(), 'loklm-shots-'))
console.log(`→ userData: ${userDataDir}`)

// Strip ELECTRON_RUN_AS_NODE / ELECTRON_NO_ATTACH_CONSOLE — when those are set
// (e.g. by some IDE/agent shells), Electron behaves as plain Node and the API
// surface is never exposed, so `app.whenReady()` fails with "undefined".
const cleanEnv = { ...process.env }
delete cleanEnv.ELECTRON_RUN_AS_NODE
delete cleanEnv.ELECTRON_NO_ATTACH_CONSOLE

const app = await electron.launch({
  args: [mainEntry, `--user-data-dir=${userDataDir}`],
  env: cleanEnv,
})
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')

// 1400x900 keeps the hero's source-of-truth aspect; we crop in post if needed.
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0]
  if (w) {
    w.setMenuBarVisibility(false)
    w.setSize(1400, 900)
    w.center()
  }
})
await page.waitForTimeout(400)

async function shot(name) {
  const file = join(outDir, `${name}.png`)
  await page.screenshot({ path: file })
  console.log(`  📸 ${name}.png`)
}

// ============================================================
// PHASE 1 — Register screen (deepdive-vault)
// ============================================================
console.log('\n[1/7] register screen')

await page.locator('input[type="text"]').first().fill('Denys')
const pwInputs = page.locator('input[type="password"]')
await pwInputs.nth(0).fill('Studieren2026!')
await pwInputs.nth(1).fill('Studieren2026!')
// English passphrase for marketing-friendly screenshot
await page.locator('input[type="radio"][name="lang"]').nth(1).check()
await page.waitForTimeout(200)

// Submit and wait for passphrase reveal — that's the stronger "vault" visual
await page.locator('button[type="submit"]').click()
await page.getByRole('heading', { name: 'Wiederherstellungs-Wörter' }).waitFor({ timeout: 30_000 })
await page.waitForTimeout(400)
await shot('deepdive-vault')

// Acknowledge and continue
await page.getByRole('checkbox').check()
await page.getByRole('button', { name: 'Weiter' }).click()

// ============================================================
// PHASE 2 — Create workspace + import PDF via IPC
// ============================================================
console.log('\n[2/7] workspace + import')

// Wait for the app shell (sidebar visible)
await page.waitForSelector('.app-shell', { timeout: 30_000 })
await page.waitForTimeout(500)

const workspaceId = await page.evaluate(async () => {
  const w = await window.api.workspaces.create('Studium')
  return w.id
})
console.log(`  workspace #${workspaceId}`)

// AppShell only fetches workspaces on mount, so reload to pick up the new
// workspace. Auth state survives the reload because the DEK lives in the
// main process.
await page.reload()
await page.waitForLoadState('domcontentloaded')
await page.waitForSelector('.library', { timeout: 30_000 })
await page.waitForTimeout(400)

// Kick off import — UI uses a native picker we can't drive, so go through IPC
const docId = await page.evaluate(
  async ({ wid, path }) => {
    const d = await window.api.documents.import(wid, path)
    return d.id
  },
  { wid: workspaceId, path: pdfPath },
)
console.log(`  doc #${docId} imported, waiting for ready…`)

// Poll until indexed (status 'ready'). Indexing the 15-page paper through
// pdf-parse + chunker + embedder takes a while on a cold start.
const indexed = await page.evaluate(
  async ({ wid, did }) => {
    const deadline = Date.now() + 180_000
    while (Date.now() < deadline) {
      const list = await window.api.documents.list(wid)
      const doc = list.find((d) => d.id === did)
      if (doc?.status === 'ready') return true
      await new Promise((r) => setTimeout(r, 1000))
    }
    return false
  },
  { wid: workspaceId, did: docId },
)
if (!indexed) fail('Document never reached ready status within 3 minutes.')
console.log('  ✓ doc ready')
await page.waitForTimeout(400)

await shot('step1-import')

// ============================================================
// PHASE 2.5 — Wait for the LLM to finish loading. autoLoad() kicks off in
// the background on register; if we send before it's ready, QAService
// returns the fallback "Modell lädt noch oder ist nicht bereit" view (just
// retrieval chunks) instead of a generated answer.
// ============================================================
console.log('\n[2.5/7] waiting for LLM ready…')
const llmReady = await page.evaluate(async () => {
  const deadline = Date.now() + 300_000
  let lastState = null
  while (Date.now() < deadline) {
    const s = await window.api.llm.status()
    if (s.state !== lastState) {
      console.log(`  llm state: ${s.state}`)
      lastState = s.state
    }
    if (s.state === 'ready') return { ok: true, state: s.state }
    if (s.state === 'failed') return { ok: false, state: s.state, message: s.message }
    await new Promise((r) => setTimeout(r, 1500))
  }
  return { ok: false, state: 'timeout' }
})
if (!llmReady.ok) {
  fail(`LLM never reached 'ready' (last state: ${llmReady.state}${llmReady.message ? `: ${llmReady.message}` : ''})`)
}
console.log('  ✓ LLM ready')

// ============================================================
// PHASE 3 — Switch to chat, type question, send
// ============================================================
console.log('\n[3/7] chat view')

// Force-click in case the sidebar peeking layout is interfering, and dump
// some state so a timeout below doesn't leave us guessing.
await page.locator('button[aria-label="Chat"]').click({ force: true })
await page.waitForTimeout(1000)
const debugAfterChatClick = await page.evaluate(() => ({
  hasTextarea: !!document.querySelector('textarea.chat__input'),
  hasChatSection: !!document.querySelector('section.chat'),
  hasLibrary: !!document.querySelector('.library'),
  buttons: Array.from(document.querySelectorAll('button[aria-label]')).map((b) => b.getAttribute('aria-label')),
}))
console.log('  post-click state:', JSON.stringify(debugAfterChatClick))
if (!debugAfterChatClick.hasTextarea) {
  await shot('debug-after-chat-click')
}
await page.waitForSelector('textarea.chat__input', { timeout: 15_000 })

const question = 'Why does the Transformer architecture avoid recurrence, and what replaces it?'
await page.locator('textarea.chat__input').fill(question)
await page.waitForTimeout(300)

await shot('step2-ask')

// Send. Cold-start model load (Qwen3 4B/8B) can take 30-90s before the first
// token even arrives, then more streaming after that.
await page.locator('button[aria-label="Send message"]').click()
console.log('  sending, waiting for model load + first tokens…')

// Wait for at least the first assistant token to appear so we know the model
// is producing output. 5 min cold-start budget.
await page.waitForFunction(
  () => {
    const bubbles = document.querySelectorAll('.chat__message-row')
    if (bubbles.length < 2) return false
    const last = bubbles[bubbles.length - 1]
    return (last.textContent || '').trim().length > 20
  },
  undefined,
  { timeout: 300_000 },
)
console.log('  first tokens arrived; waiting for stream to finish…')

// Wait until streaming finishes (cancel button disappears).
await page
  .waitForFunction(
    () => !document.querySelector('button[aria-label="Cancel streaming"]'),
    undefined,
    { timeout: 300_000 },
  )
  .catch(() => console.warn('  (stream did not finish before deadline; capturing anyway)'))

// Brief settle so the final layout is stable before screenshotting
await page.waitForTimeout(800)
await shot('hero-chat')

// ============================================================
// PHASE 4 — Source viewer
// ============================================================
console.log('\n[4/7] source viewer')

// Citation chips are <a class="citation-chip"> anchors, not [N] markers.
const firstCitation = await page.evaluate(() => {
  const chip = document.querySelector('a.citation-chip')
  if (!chip) return null
  chip.scrollIntoView({ block: 'center' })
  chip.click()
  return (chip.textContent || '').trim()
})
if (!firstCitation) {
  console.warn('  (no citation chip found; step3-verify/deepdive-citation will lack source viewer)')
} else {
  console.log(`  clicked citation: ${firstCitation}`)
}

// Wait for the source viewer to actually render
await page
  .waitForSelector('[aria-label="Close source viewer"]', { timeout: 10_000 })
  .catch(() => undefined)
await page.waitForTimeout(1200)

await shot('step3-verify')
await page.waitForTimeout(400)
await shot('deepdive-citation')

// ============================================================
// PHASE 5 — Offline indicator shot (library, status dots green in titlebar)
// ============================================================
console.log('\n[5/7] offline indicator')

// Close source viewer via its specific button (NOT [aria-label="Schließen"]
// which is the window-close button in the title bar).
const closeBtn = page.locator('[aria-label="Close source viewer"]')
if ((await closeBtn.count()) > 0) {
  await closeBtn.first().click()
  await page.waitForTimeout(400)
}

// Back to library for a clean shot with all three status dots green in the titlebar
await page.locator('button[aria-label="Library"]').click()
await page.waitForTimeout(700)
await shot('deepdive-offline')

// ============================================================
// Done — close app, run ffmpeg
// ============================================================
console.log('\n[6/7] closing app')
await app.close().catch(() => undefined)
await rm(userDataDir, { recursive: true, force: true })

console.log('\n[7/7] converting PNG → webp via ffmpeg')

function ffmpeg(args) {
  return new Promise((resolveP, rejectP) => {
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    p.stderr.on('data', (d) => (stderr += d.toString()))
    p.on('exit', (code) =>
      code === 0 ? resolveP() : rejectP(new Error(`ffmpeg exit ${code}\n${stderr}`)),
    )
  })
}

for (const { name, target } of SCENES) {
  const src = join(outDir, `${name}.png`)
  if (!existsSync(src)) {
    console.warn(`  ⚠ ${name}.png missing, skipping`)
    continue
  }
  const [w, h] = target
  const main = join(finalDir, `${name}.webp`)
  const onex = join(finalDir, `${name}@1x.webp`)
  // -y overwrites. quality 88 gives sharp text without bloated file sizes.
  // crop=w:h:(iw-w)/2:0 takes a w×h region centered horizontally from the top.
  await ffmpeg([
    '-y',
    '-i',
    src,
    '-vf',
    `crop=min(iw\\,${w}):min(ih\\,${h}):(iw-min(iw\\,${w}))/2:0,scale=${w}:${h}`,
    '-c:v',
    'libwebp',
    '-quality',
    '88',
    main,
  ])
  await ffmpeg([
    '-y',
    '-i',
    src,
    '-vf',
    `crop=min(iw\\,${w}):min(ih\\,${h}):(iw-min(iw\\,${w}))/2:0,scale=${Math.round(w / 2)}:${Math.round(h / 2)}`,
    '-c:v',
    'libwebp',
    '-quality',
    '85',
    onex,
  ])
  console.log(`  ✓ ${name}.webp + ${name}@1x.webp`)
}

console.log(`\n✓ done. PNGs in ${outDir}, webp in ${finalDir}`)
