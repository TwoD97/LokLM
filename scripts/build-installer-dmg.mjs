// Wraps the Tauri-built mac wizard ( LokLM-Installer.app , ~10 MB ) into
// a user-facing release/LokLM-Installer.dmg via create-dmg.
//
// Mac-only ; on other hosts the script fails fast so a typo in a CI
// matrix doesn't silently produce a broken artifact.
//
// Pipeline order :
//   1. cargo tauri build                  ( produces .../bundle/macos/LokLM-Installer.app )
//   2. npx create-dmg <app> <out-dir>     ( wraps the .app into a .dmg )
//   3. rename to release/LokLM-Installer.dmg ( stable filename ; the
//      website's download button points here )

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, statSync } from 'node:fs'
import { rm, readdir, rename } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

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
    console.error('build-installer-dmg.mjs must run on macOS ( got platform=' + process.platform + ' )')
    process.exit(2)
  }

  const wizardDir = join(ROOT, 'installer-wizard', 'src-tauri')

  const env = { ...process.env }
  const cargoBin = cargoBinDir()
  if (cargoBin) env.PATH = `${cargoBin}${delimiter}${env.PATH || ''}`

  // 1) Build the Tauri wizard for the host arch. We DO want the .app
  //    bundle this time ( unlike windows where --no-bundle is correct
  //    because NSIS wraps the raw .exe ) , so omit --no-bundle.
  console.log('cargo tauri build ...')
  await execFileAsync('cargo', ['tauri', 'build'], {
    cwd: wizardDir,
    env,
    stdio: 'inherit',
    maxBuffer: 128 * 1024 * 1024,
    shell: true,
  })

  const built = join(
    wizardDir,
    'target',
    'release',
    'bundle',
    'macos',
    'LokLM Installer.app',
  )
  // Tauri uses the productName from tauri.conf.json verbatim , so the
  // bundle is "LokLM Installer.app" ( with a space ) , not the slug.
  if (!existsSync(built)) {
    throw new Error(`expected ${built} ; cargo tauri build did not produce the .app bundle`)
  }

  // 2) Pack into a DMG via create-dmg ( npm ).
  const releaseDir = join(ROOT, 'release')
  const dmgPath = join(releaseDir, 'LokLM-Installer.dmg')
  if (existsSync(dmgPath)) await rm(dmgPath)
  console.log('npx create-dmg ...')
  const { stdout } = await execFileAsync(
    'npx',
    ['create-dmg', built, releaseDir, '--overwrite'],
    { maxBuffer: 64 * 1024 * 1024 },
  )
  console.log(stdout.trim().split('\n').slice(-5).join('\n'))

  // 3) Stable filename. create-dmg names its output "<AppName> <version>.dmg"
  //    by default ; the website's download button URL is stable so we rename.
  const produced = (await readdir(releaseDir)).find(
    (f) => f.startsWith('LokLM Installer') && f.endsWith('.dmg'),
  )
  if (!produced) {
    throw new Error('create-dmg did not produce a .dmg in release/')
  }
  await rename(join(releaseDir, produced), dmgPath)
  console.log(
    `built ${dmgPath} ( ${(statSync(dmgPath).size / 1024 / 1024).toFixed(1)} MB )`,
  )
}

main().catch((err) => {
  console.error(err.stack || err.message)
  process.exit(1)
})
