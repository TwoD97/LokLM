// Compiles installer-ui/stub.nsi into release/LokLM-Setup-<v>-win-x64.exe.
//
// Inputs ( produced by earlier package:win:payload + package:win:installer
// + build:installer-splash stages ) :
//   release/win-unpacked/                  ← LokLM payload
//   release/installer/win-unpacked/        ← electron wizard ( dir target )
//   resources/installer-splash.bmp         ← 720x400 BMP for Splash::show
//
// Output :
//   release/LokLM-Setup-<v>-win-x64.exe    ← the actual installer
//
// makensis is looked up in this order :
//   1. $PATH ( a system NSIS install )
//   2. electron-builder's cache at %LOCALAPPDATA%\electron-builder\Cache\nsis
//      ( populated automatically the first time you run an electron-builder
//        NSIS-target build )
//   3. C:\Program Files (x86)\NSIS , C:\Program Files\NSIS

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
    // fall through to other lookups
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
      "to let it download NSIS into %LOCALAPPDATA%\\electron-builder\\Cache , or " +
      'install NSIS system-wide from https://nsis.sourceforge.io/',
  )
}

async function requireFile(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} missing : ${path}`)
  }
}

async function main() {
  const installerDir = join(ROOT, 'release', 'installer', 'win-unpacked')
  const payloadDir = join(ROOT, 'release', 'win-unpacked')
  const splashBmp = join(ROOT, 'resources', 'installer-splash.bmp')
  const iconPath = join(ROOT, 'resources', 'icon.ico')
  const nsiScript = join(ROOT, 'installer-ui', 'stub.nsi')

  await requireFile(installerDir, 'installer dir')
  await requireFile(payloadDir, 'payload dir')
  await requireFile(splashBmp, 'splash bmp')
  await requireFile(iconPath, 'icon.ico')
  await requireFile(nsiScript, 'stub.nsi')

  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  const version = pkg.version
  const outputFile = join(ROOT, 'release', `LokLM-Setup-${version}-win-x64.exe`)

  const makensis = await findMakensis()
  console.log(`makensis      : ${makensis}`)
  console.log(`installer-app : ${installerDir}`)
  console.log(`payload       : ${payloadDir}`)
  console.log(`splash        : ${splashBmp}`)
  console.log(`icon          : ${iconPath}`)
  console.log(`output        : ${outputFile}`)
  console.log('compiling NSIS stub ...')

  const args = [
    `/DPRODUCT_VERSION=${version}`,
    `/DINSTALLER_DIR=${installerDir}`,
    `/DPAYLOAD_DIR=${payloadDir}`,
    `/DSPLASH_BMP=${splashBmp}`,
    `/DICON_PATH=${iconPath}`,
    `/DOUTPUT_FILE=${outputFile}`,
    nsiScript,
  ]

  const { stdout, stderr } = await execFileAsync(makensis, args, {
    windowsHide: true,
    maxBuffer: 128 * 1024 * 1024,
  })
  if (stderr && stderr.trim()) console.error(stderr)
  // makensis is chatty by default ; only print the tail so we see the
  // EXE-output line + any warnings without flooding the log.
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
