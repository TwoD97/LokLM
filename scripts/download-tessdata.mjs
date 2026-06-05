// Downloads the Tesseract `best` (LSTM, highest-accuracy) traineddata for the
// languages LokLM ships, into ./tessdata. electron-builder copies this folder
// to <resources>/tessdata via build.extraResources, and the OCR module resolves
// it there at runtime so OCR works 100% offline after install.
//
// Run manually (`pnpm tessdata`) or it is invoked before packaging. Files are
// ~13–15 MB each; we skip any that already exist unless --force is passed.

import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'tessdata')

// tessdata_best = float LSTM models, the most accurate variant. Pinned to a
// commit-free `main` raw URL; GitHub redirects to raw.githubusercontent.com,
// which global fetch follows automatically.
const BASE = 'https://github.com/tesseract-ocr/tessdata_best/raw/main'
const LANGS = ['eng', 'deu']

const force = process.argv.includes('--force')

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
  console.log(`tessdata → ${OUT_DIR}`)
  for (const lang of LANGS) {
    await downloadOne(lang)
  }
  console.log('done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
