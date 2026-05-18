#!/usr/bin/env node
// patcht website/src/data/releases.ts , setzt sha256 + sizeBytes + available
// für einen platform-asset. wird vom release-workflow nach erfolgreichem
// build aufgerufen. usage:
//   node scripts/bump-release.mjs <version> <platform> <sha256> <sizeBytes>
//
// idempotent , gleicher input → gleicher output. fails wenn kein matchendes
// asset im manifest gefunden wird.

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const [, , version, platform, sha256, sizeArg] = process.argv
if (!version || !platform || !sha256 || !sizeArg) {
  console.error('usage: bump-release.mjs <version> <platform> <sha256> <sizeBytes>')
  process.exit(1)
}
const sizeBytes = Number.parseInt(sizeArg, 10)
if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
  console.error(`invalid sizeBytes: ${sizeArg}`)
  process.exit(1)
}

const file = resolve('website/src/data/releases.ts')
const src = await readFile(file, 'utf8')

// versions-string updaten (currentRelease.version).
const versionRe = /(\bversion:\s*)'[^']*'/
const releasedAtRe = /(\breleasedAt:\s*)'[^']*'/
const today = new Date().toISOString().slice(0, 10)

let next = src
  .replace(versionRe, `$1'${version}'`)
  .replace(releasedAtRe, `$1'${today}'`)

// asset-block für die platform suchen + felder patchen.
const platformBlockRe = new RegExp(
  `(\\{\\s*platform:\\s*'${platform}'[^}]*?)\\}`,
  's',
)
const match = next.match(platformBlockRe)
if (!match) {
  console.error(`no asset block found for platform=${platform}`)
  process.exit(1)
}

let block = match[1]
block = block
  .replace(/(\bfile:\s*)'[^']*'/, `$1'${assetFileName(platform, version)}'`)
  .replace(/(\bsizeBytes:\s*)\d+/, `$1${sizeBytes}`)
  .replace(/(\bsha256:\s*)'[^']*'/, `$1'${sha256}'`)
  .replace(/(\bavailable:\s*)(true|false)/, '$1true')

next = next.replace(platformBlockRe, `${block}}`)

await writeFile(file, next)
console.log(`patched releases.ts , version=${version} platform=${platform} sha256=${sha256.slice(0, 12)}… size=${sizeBytes}`)

function assetFileName(p, v) {
  switch (p) {
    case 'windows':
      return `LokLM-Setup-${v}.exe`
    case 'macos':
      return `LokLM-${v}.dmg`
    case 'linux':
      return `LokLM-${v}.AppImage`
    default:
      throw new Error(`unknown platform: ${p}`)
  }
}
