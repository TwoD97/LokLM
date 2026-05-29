// Wraps the Tauri-built wizard exe ( + LICENSE ) AND the full electron
// payload ( release/win-unpacked ) into a single self-contained
// release/LokLM-x64.exe via NSIS. The base app payload is embedded so the
// installer doesn't fetch-and-execute it from a CDN — that tiny-stub
// pattern tripped Defender's Wacatac.B!ml heuristic. The optional CUDA
// addon + GGUF models are still fetched at install time ( see
// installer/download.rs + payload_manifest.rs ). The final .exe is ~370 MB.
//
// Inputs ( produced by earlier pipeline stages ) :
//   installer-wizard/src-tauri/target/release/loklm.exe  ← Tauri wizard ( ~3 MB )
//   release/win-unpacked/                                          ← electron payload ( ~370 MB )
//   resources/icon.ico                                             ← Setup.exe icon
//   LICENSE                                                        ← packaged alongside the wizard
//
// Output :
//   release/LokLM-x64.exe                                          ← what users download
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
import { signWindows } from './sign-windows.mjs'

const execFileAsync = promisify(execFile)
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

async function findMakensis() {
  // 1. Repo-portable NSIS first ( installer-wizard/.nsis-portable/ ).
  //    Pinned to 3.11+ because the electron-builder cache ships NSIS 3.0.4
  //    ( from 2017 ) whose generated manifest still trips Windows 11 25H2's
  //    AppCompat installer-detection heuristic , forcing UAC even with
  //    RequestExecutionLevel=user. NSIS 3.11's manifest format passes
  //    cleanly. To refresh : download nsis-X.Y.zip from sourceforge into
  //    installer-wizard/.nsis-portable/ and unzip.
  const portableRoot = join(ROOT, 'installer-wizard', '.nsis-portable')
  if (existsSync(portableRoot)) {
    for (const entry of await readdir(portableRoot)) {
      const candidate = join(portableRoot, entry, 'Bin', 'makensis.exe')
      if (existsSync(candidate)) return candidate
    }
  }

  // 2. System PATH.
  try {
    await execFileAsync('makensis', ['/VERSION'], { windowsHide: true })
    return 'makensis'
  } catch {
    // fall through
  }

  // 3. System install dirs ( Chocolatey , standalone installer ).
  for (const p of [
    'C:\\Program Files (x86)\\NSIS\\makensis.exe',
    'C:\\Program Files\\NSIS\\makensis.exe',
  ]) {
    if (existsSync(p)) return p
  }

  // 4. electron-builder cache ( last resort — likely OLD NSIS , may trip
  //    Win11 AppCompat ; emit warning when this is the only candidate ).
  const cacheRoot = join(
    process.env.LOCALAPPDATA || join(process.env.USERPROFILE || '', 'AppData', 'Local'),
    'electron-builder',
    'Cache',
    'nsis',
  )
  if (existsSync(cacheRoot)) {
    for (const entry of await readdir(cacheRoot)) {
      const candidate = join(cacheRoot, entry, 'Bin', 'makensis.exe')
      if (existsSync(candidate)) {
        console.warn(
          `WARNING : falling back to electron-builder's cached NSIS ( ${entry} ). ` +
            `If the installer asks for admin on Win11 , download nsis-3.11.zip from ` +
            `sourceforge into installer-wizard/.nsis-portable/ and re-run.`,
        )
        return candidate
      }
    }
  }

  throw new Error(
    'makensis.exe not found. Either : (a) drop nsis-3.11.zip into installer-wizard/.nsis-portable/ , ' +
      ' (b) install NSIS 3.11 system-wide from https://nsis.sourceforge.io/ , or ' +
      ' (c) run any electron-builder NSIS-target build once to populate %LOCALAPPDATA%\\electron-builder\\Cache ' +
      '( WARNING : cache ships OLD NSIS that trips Win11 AppCompat — option (a) preferred ).',
  )
}

async function requireFile(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} missing : ${path}`)
  }
}

async function main() {
  const wizardExe = join(ROOT, 'installer-wizard', 'src-tauri', 'target', 'release', 'loklm.exe')
  const iconPath = join(ROOT, 'resources', 'icon.ico')
  const nsiScript = join(ROOT, 'installer-wizard', 'stub.nsi')
  // The full electron payload ( produced by package:win:payload ). It's
  // embedded raw into the stub so the installer is self-contained — the
  // wizard's payload_dir() finds it via ..\win-unpacked at runtime.
  const payloadDir = join(ROOT, 'release', 'win-unpacked')

  await requireFile(wizardExe, 'wizard exe ( cargo tauri build first )')
  await requireFile(iconPath, 'icon.ico')
  await requireFile(nsiScript, 'stub.nsi')
  await requireFile(payloadDir, 'payload dir release/win-unpacked ( run package:win:payload first )')

  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  const version = pkg.version
  // Version stays out of the filename ; it's embedded in the .exe's
  // VS_VERSION_INFO via stub.nsi ( VIProductVersion + VIAddVersionKey
  // FileVersion / ProductVersion ). The URL path on Bunny still has the
  // version folder so we can roll back , but the filename inside is
  // stable across releases ( matches the website's Download button URL ).
  // Filename matters : "Setup" trips Win11 IDT and forces UAC even with
  // asInvoker , locking out non-admin users entirely. "Wizard" also trips
  // it ( verified empirically , undocumented heuristic ). Going fully
  // bland — "LokLM-x64.exe" reads as a regular release binary.
  const outputFile = join(ROOT, 'release', 'LokLM-x64.exe')

  // Repo LICENSE goes into the NSIS bundle so the wizard's get_license
  // command can read it at runtime ( extracted to $INSTDIR\installer\LICENSE
  // alongside loklm.exe — see stub.nsi for the layout ).
  const licensePath = join(ROOT, 'LICENSE')
  await requireFile(licensePath, 'LICENSE ( repo root )')

  const makensis = await findMakensis()
  console.log(`makensis : ${makensis}`)
  console.log(`wizard   : ${wizardExe}`)
  console.log(`payload  : ${payloadDir}`)
  console.log(`icon     : ${iconPath}`)
  console.log(`license  : ${licensePath}`)
  console.log(`output   : ${outputFile}`)

  // Sign the wizard exe BEFORE NSIS embeds it, so the binary extracted to
  // $INSTDIR\installer\loklm.exe at install time carries a signature too.
  // No-op unless LOKLM_SIGN=1.
  await signWindows([wizardExe], { label: 'wizard exe' })

  console.log('compiling NSIS stub ...')

  const args = [
    `/DPRODUCT_VERSION=${version}`,
    `/DWIZARD_EXE=${wizardExe}`,
    `/DPAYLOAD_DIR=${payloadDir}`,
    `/DICON_PATH=${iconPath}`,
    `/DLICENSE_PATH=${licensePath}`,
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

  // Sign the final installer LAST — it's the file users download, so this is
  // the signature SmartScreen / Defender evaluate. No-op unless LOKLM_SIGN=1.
  await signWindows([outputFile], { label: 'installer' })
}

main().catch((err) => {
  console.error(err.stack || err.message)
  process.exit(1)
})
