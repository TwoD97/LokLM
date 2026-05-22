// Wraps the Tauri-built wizard exe + LokLM payload into a single
// release/LokLM-Setup-<version>-win-x64.exe via NSIS.
//
// Inputs ( produced by earlier pipeline stages ) :
//   installer-wizard/src-tauri/target/release/loklm-installer.exe  ← Tauri wizard ( 2.8 MB )
//   release/win-unpacked/                                          ← LokLM payload ( ~1.2 GB )
//   resources/icon.ico                                             ← Setup.exe icon
//
// Output :
//   release/LokLM-Setup-<version>-win-x64.exe                      ← what users download
//
// makensis lookup ( in order ) :
//   1. PATH
//   2. %LOCALAPPDATA%\electron-builder\Cache\nsis\ ( auto-cached by any
//      electron-builder NSIS target build )
//   3. C:\Program Files\NSIS , C:\Program Files (x86)\NSIS

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, readdir } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

async function findMakensis() {
  try {
    await execFileAsync('makensis', ['/VERSION'], { windowsHide: true })
    return 'makensis'
  } catch {
    // fall through
  }

  const cacheRoot = join(
    process.env.LOCALAPPDATA || join(process.env.USERPROFILE || '', 'AppData', 'Local'),
    'electron-builder',
    'Cache',
    'nsis',
  )
  if (existsSync(cacheRoot)) {
    for (const entry of await readdir(cacheRoot)) {
      const candidate = join(cacheRoot, entry, 'Bin', 'makensis.exe')
      if (existsSync(candidate)) return candidate
    }
  }

  for (const p of [
    'C:\\Program Files (x86)\\NSIS\\makensis.exe',
    'C:\\Program Files\\NSIS\\makensis.exe',
  ]) {
    if (existsSync(p)) return p
  }

  throw new Error(
    'makensis.exe not found. Run any electron-builder NSIS-target build once ' +
      'to populate %LOCALAPPDATA%\\electron-builder\\Cache , or install NSIS ' +
      'system-wide from https://nsis.sourceforge.io/',
  )
}

async function requireFile(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} missing : ${path}`)
  }
}

async function main() {
  const wizardExe = join(
    ROOT,
    'installer-wizard',
    'src-tauri',
    'target',
    'release',
    'loklm-installer.exe',
  )
  const payloadDir = join(ROOT, 'release', 'win-unpacked')
  const iconPath = join(ROOT, 'resources', 'icon.ico')
  const nsiScript = join(ROOT, 'installer-wizard', 'stub.nsi')

  await requireFile(wizardExe, 'wizard exe ( cargo tauri build first )')
  await requireFile(payloadDir, 'payload dir ( pnpm package:win:payload first )')
  await requireFile(iconPath, 'icon.ico')
  await requireFile(nsiScript, 'stub.nsi')

  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  const version = pkg.version
  // Version stays out of the filename ; it's embedded in the .exe's
  // VS_VERSION_INFO via stub.nsi ( VIProductVersion + VIAddVersionKey
  // FileVersion / ProductVersion ). The URL path on Bunny still has the
  // version folder so we can roll back , but the filename inside is
  // stable across releases.
  const outputFile = join(ROOT, 'release', 'LokLM-Setup-win-x64.exe')

  const makensis = await findMakensis()
  console.log(`makensis : ${makensis}`)
  console.log(`wizard   : ${wizardExe}`)
  console.log(`payload  : ${payloadDir}`)
  console.log(`icon     : ${iconPath}`)
  console.log(`output   : ${outputFile}`)
  console.log('compiling NSIS stub ...')

  const args = [
    `/DPRODUCT_VERSION=${version}`,
    `/DWIZARD_EXE=${wizardExe}`,
    `/DPAYLOAD_DIR=${payloadDir}`,
    `/DICON_PATH=${iconPath}`,
    `/DOUTPUT_FILE=${outputFile}`,
    nsiScript,
  ]

  const { stdout, stderr } = await execFileAsync(makensis, args, {
    windowsHide: true,
    maxBuffer: 128 * 1024 * 1024,
  })
  if (stderr && stderr.trim()) console.error(stderr)
  const tail = stdout.split(/\r?\n/).slice(-10).join('\n')
  if (tail.trim()) console.log(tail)

  if (!existsSync(outputFile)) {
    throw new Error(`makensis returned 0 but ${outputFile} is missing`)
  }
  const size = statSync(outputFile).size
  console.log(`built ${outputFile} ( ${(size / 1024 / 1024).toFixed(1)} MB )`)
}

main().catch((err) => {
  console.error(err.stack || err.message)
  process.exit(1)
})
