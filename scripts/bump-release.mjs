#!/usr/bin/env node
// patcht website/src/data/releases.ts , setzt sha256 + sizeBytes + available
// für einen platform-asset. wird vom release-workflow nach erfolgreichem
// build aufgerufen. usage:
//   node scripts/bump-release.mjs <version> <platform> <sha256> <sizeBytes> [<file>]
//
// idempotent , gleicher input → gleicher output. fails wenn kein matchendes
// asset im manifest gefunden wird.
//
// <file> ist optional und disambiguiert , wenn eine platform mehrere assets
// hat ( seit v0.3.2 : Linux hat .run + .deb ). Wird er weggelassen , greift
// der Default in defaultFileName() — pro platform genau ein asset.

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const [, , version, platform, sha256, sizeArg, fileArg] = process.argv
if (!version || !platform || !sha256 || !sizeArg) {
  console.error('usage: bump-release.mjs <version> <platform> <sha256> <sizeBytes> [<file>]')
  process.exit(1)
}
const sizeBytes = Number.parseInt(sizeArg, 10)
if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
  console.error(`invalid sizeBytes: ${sizeArg}`)
  process.exit(1)
}
const fileName = fileArg || defaultFileName(platform)

const path = resolve('website/src/data/releases.ts')
const src = await readFile(path, 'utf8')

// versions-string updaten (currentRelease.version).
const versionRe = /(\bversion:\s*)'[^']*'/
const releasedAtRe = /(\breleasedAt:\s*)'[^']*'/
const today = new Date().toISOString().slice(0, 10)

let next = src
  .replace(versionRe, `$1'${version}'`)
  .replace(releasedAtRe, `$1'${today}'`)

// Alle blocks der platform sammeln , dann nach file disambiguieren.
const blockRe = new RegExp(
  `\\{\\s*platform:\\s*'${platform}'[^}]*?\\}`,
  'gs',
)
const candidates = [...next.matchAll(blockRe)]
if (candidates.length === 0) {
  console.error(`no asset block found for platform=${platform}`)
  process.exit(1)
}

const fileNeedle = `file: '${fileName}'`
const target = candidates.find((m) => m[0].includes(fileNeedle))
if (!target) {
  console.error(
    `no asset block found for platform=${platform} file=${fileName} ` +
      `( candidates : ${candidates.length} block(s) for this platform )`,
  )
  process.exit(1)
}

let block = target[0]
block = block
  .replace(/(\bfile:\s*)'[^']*'/, `$1'${fileName}'`)
  .replace(/(\bsizeBytes:\s*)\d+/, `$1${sizeBytes}`)
  .replace(/(\bsha256:\s*)'[^']*'/, `$1'${sha256}'`)
  .replace(/(\bavailable:\s*)(true|false)/, '$1true')

next = next.slice(0, target.index) + block + next.slice(target.index + target[0].length)

await writeFile(path, next)
console.log(
  `patched releases.ts , version=${version} platform=${platform} file=${fileName} ` +
    `sha256=${sha256.slice(0, 12)}… size=${sizeBytes}`,
)

function defaultFileName(p) {
  // Used when no explicit <file> arg is supplied. For platforms with a
  // single asset ( windows / macos ) this is the canonical filename.
  // Linux defaults to .run for back-compat ; .deb invocations must pass
  // the file arg explicitly.
  switch (p) {
    case 'windows':
      // v0.3.0+ : renamed from LokLM-Setup-win-x64.exe to dodge Win11's
      // Installer Detection Technology shim , which silently refused to
      // launch the setup-named .exe without UAC elevation. "LokLM" alone
      // isn't on IDT's keyword list ; verified on a non-admin user.
      return 'LokLM-x64.exe'
    case 'macos':
      return 'LokLM-mac.dmg'
    case 'linux':
      return 'LokLM-Setup-linux-x64.run'
    default:
      throw new Error(`unknown platform: ${p}`)
  }
}
