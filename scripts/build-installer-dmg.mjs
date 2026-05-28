// Wraps the Tauri-built mac wizard ( LokLM.app , ~10 MB ) into a user-
// facing release/LokLM-mac.dmg via create-dmg.
//
// Mac-only ; on other hosts the script fails fast so a typo in a CI
// matrix doesn't silently produce a broken artifact.
//
// Pipeline order :
//   1. cargo tauri build               ( produces .../bundle/macos/LokLM.app )
//   2. npx create-dmg <app> <out-dir>  ( wraps the .app into a .dmg )
//   3. rename to release/LokLM-mac.dmg ( stable filename ; matches v0.2.x
//      naming so website + bump-release.mjs + workflow paths stay unchanged )

import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { rm, readdir, rename } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// spawn + stdio:'inherit' so cargo / tauri / create-dmg output streams
// to the parent terminal in real time AND non-zero exit codes reliably
// fail the script. promisify(execFile)'s stdio:'inherit' is silently
// ignored ( the option is documented for spawn , not execFile ) , so
// errors got swallowed in the original implementation and tauri's bundle
// failures looked like our existsSync check failing.
function runInherit(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', ...opts })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`))
    })
  })
}

function cargoBinDir() {
  // Same defensive PATH prepend the windows wizard script uses ; rustup's
  // default install on mac doesn't modify shell PATH for new sessions.
  const home = process.env.HOME
  if (!home) return null
  const candidate = join(home, '.cargo', 'bin')
  return existsSync(candidate) ? candidate : null
}

async function main() {
  if (process.platform !== 'darwin') {
    console.error(
      'build-installer-dmg.mjs must run on macOS ( got platform=' + process.platform + ' )',
    )
    process.exit(2)
  }

  const wizardDir = join(ROOT, 'installer-wizard', 'src-tauri')

  const env = { ...process.env }
  const cargoBin = cargoBinDir()
  if (cargoBin) env.PATH = `${cargoBin}${delimiter}${env.PATH || ''}`

  // 1) Build the Tauri wizard for the host arch. We need the .app
  //    bundle but NOT the dmg ( our own create-dmg step below does that ).
  //    --bundles app tells tauri-cli to skip every other bundler target
  //    listed in tauri.conf.json ( nsis on win is irrelevant on mac ,
  //    dmg would otherwise run bundle_dmg.sh which has been crashing on
  //    macos-latest with "hdiutil: create failed - Resource busy" ).
  //    --verbose surfaces any bundle-step failures in CI logs.
  console.log('cargo tauri build --bundles app --verbose ...')
  await runInherit('cargo', ['tauri', 'build', '--bundles', 'app', '--verbose'], {
    cwd: wizardDir,
    env,
  })

  // Tauri uses productName from tauri.conf.json verbatim. After the v0.3.0
  // IDT-bypass rename it's just "LokLM" — bundle is "LokLM.app". If tauri
  // produces it elsewhere ( name mismatch , version mismatch , etc. ) the
  // fallback search picks any .app in the macos bundle dir.
  const macosBundleDir = join(wizardDir, 'target', 'release', 'bundle', 'macos')
  let built = join(macosBundleDir, 'LokLM.app')
  if (!existsSync(built)) {
    if (existsSync(macosBundleDir)) {
      const found = (await readdir(macosBundleDir)).find((f) => f.endsWith('.app'))
      if (found) {
        built = join(macosBundleDir, found)
        console.warn(`expected LokLM.app , using ${found}`)
      }
    }
    if (!existsSync(built)) {
      throw new Error(
        `expected ${built} ; cargo tauri build did not produce a .app bundle in ${macosBundleDir}`,
      )
    }
  }

  // 2) Pack into a DMG via create-dmg ( npm ).
  //    --no-code-sign : create-dmg v8.x exits with code 2 if no Developer ID
  //    Application cert is in the keychain ( "No suitable code signing
  //    identity found" ). github-hosted macos-latest runners don't have one ,
  //    and the wizard ships unsigned anyway ( see CSC_IDENTITY_AUTO_DISCOVERY
  //    + tauri.conf identity:null ; users see Gatekeeper "right-click → Open"
  //    on first launch ). The flag skips the signing step entirely so the
  //    DMG step doesn't fail the release pipeline.
  const releaseDir = join(ROOT, 'release')
  const dmgPath = join(releaseDir, 'LokLM-mac.dmg')
  if (existsSync(dmgPath)) await rm(dmgPath)
  console.log('npx create-dmg --no-code-sign ...')
  await runInherit('npx', ['create-dmg', '--no-code-sign', built, releaseDir, '--overwrite'])

  // 3) create-dmg names its output "<AppName> <version>.dmg" by default
  //    ( e.g. "LokLM 0.3.0.dmg" ). Rename to the stable LokLM-mac.dmg so
  //    the website's download button URL is stable across releases.
  const produced = (await readdir(releaseDir)).find(
    (f) => f.startsWith('LokLM') && f.endsWith('.dmg') && f !== 'LokLM-mac.dmg',
  )
  if (!produced) {
    throw new Error('create-dmg did not produce a .dmg in release/')
  }
  await rename(join(releaseDir, produced), dmgPath)
  console.log(`built ${dmgPath} ( ${(statSync(dmgPath).size / 1024 / 1024).toFixed(1)} MB )`)
}

main().catch((err) => {
  console.error(err.stack || err.message)
  process.exit(1)
})
