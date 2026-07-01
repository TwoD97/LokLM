// Downloads the Tesseract `fast` (integer LSTM) traineddata for the languages
// LokLM ships, into ./tessdata. electron-builder copies this folder to
// <resources>/tessdata via build.extraResources, and the OCR module resolves
// it there at runtime so OCR works 100% offline after install.
//
// Run manually (`pnpm tessdata`) — and the package:<plat>:payload scripts run
// it automatically so packaged builds (local and CI, whose runners start with
// no tessdata/ at all) always contain the current models. A download failure
// aborts the build rather than shipping an installer without OCR. Files are
// ~2–5 MB each; we skip any that already exist unless --force is passed or
// the on-disk variant differs (see VARIANT marker below).

import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'tessdata')

// tessdata_fast = integer LSTM models, ~3-4× faster to recognise than the
// float `best` variant at a small accuracy cost — the trade-off LokLM wants
// for indexing whole scanned documents. Pinned to a commit-free `main` raw
// URL; GitHub redirects to raw.githubusercontent.com, which global fetch
// follows automatically.
const BASE = 'https://github.com/tesseract-ocr/tessdata_fast/raw/main'
const LANGS = ['eng', 'deu']

// Marker recording which variant the on-disk files came from. Without it, a
// checkout still holding the old `best` models would skip on "file exists"
// and silently keep the slow variant.
const VARIANT = 'fast'
const VARIANT_FILE = join(OUT_DIR, 'VARIANT')
const variantOnDisk = existsSync(VARIANT_FILE) ? readFileSync(VARIANT_FILE, 'utf-8').trim() : null

const force = process.argv.includes('--force') || variantOnDisk !== VARIANT

async function downloadOne(lang) {
  const dest = join(OUT_DIR, `${lang}.traineddata`)
  if (existsSync(dest) && !force) {
    const mb = (statSync(dest).size / 1024 / 1024).toFixed(1)
    console.log(`  ${lang}.traineddata already present (${mb} MB) — skipping`)
    return
  }
  const url = `${BASE}/${lang}.traineddata`
  console.log(`  fetching ${url}`)
  const res = await fetch(url)
  if (!res.ok || !res.body) {
    throw new Error(`download failed for ${lang}: HTTP ${res.status}`)
  }
  const tmp = `${dest}.part`
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp))
  // Atomic-ish rename so an interrupted download never leaves a truncated
  // .traineddata that tesseract would later choke on.
  const { rename } = await import('node:fs/promises')
  await rm(dest, { force: true })
  await rename(tmp, dest)
  const mb = (statSync(dest).size / 1024 / 1024).toFixed(1)
  console.log(`  wrote ${lang}.traineddata (${mb} MB)`)
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  console.log(`tessdata (${VARIANT}) → ${OUT_DIR}`)
  if (variantOnDisk !== null && variantOnDisk !== VARIANT) {
    console.log(`  variant changed (${variantOnDisk} → ${VARIANT}) — re-downloading everything`)
  }
  for (const lang of LANGS) {
    await downloadOne(lang)
  }
  writeFileSync(VARIANT_FILE, `${VARIANT}\n`)
  console.log('done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
