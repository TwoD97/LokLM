// Wraps the Tauri-built Linux wizard binary + LokLM payload into a
// single self-extracting .run file via makeself ( https://makeself.io ).
//
// Inputs ( produced by earlier pipeline stages ) :
//   installer-wizard/src-tauri/target/release/loklm-installer  ← wizard ( ~3-4 MB )
//   release/linux-unpacked/                                    ← LokLM payload ( ~1.2 GB )
//   LICENSE                                                    ← packaged alongside the wizard
//
// Output :
//   release/LokLM-Setup-<version>-linux-x64.run                ← what users download
//
// User flow after download :
//   chmod +x LokLM-Setup-*.run
//   ./LokLM-Setup-*.run
//   → makeself extracts to /tmp/selfgz<pid> , runs run-install.sh ,
//     which exec's the wizard. Wizard's payload_dir() finds the
//     sibling linux-unpacked dir and copies files to $XDG_DATA_HOME/loklm.
//
// makeself is expected on PATH ( `apt install makeself` , `dnf install
// makeself` , or via the upstream tarball ). We don't bundle it ; CI
// installs it once.

import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, mkdir, writeFile, cp, chmod, rm } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

async function findMakeself() {
  try {
    await execFileAsync('makeself', ['--version'])
    return 'makeself'
  } catch {}
  try {
    await execFileAsync('makeself.sh', ['--version'])
    return 'makeself.sh'
  } catch {}
  throw new Error(
    'makeself not found on PATH. Install via `apt install makeself` , ' +
      '`dnf install makeself` , or the upstream tarball at https://makeself.io',
  )
}

async function requireFile(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} missing : ${path}`)
  }
}

async function main() {
  const wizardBin = join(
    ROOT,
    'installer-wizard',
    'src-tauri',
    'target',
    'release',
    'loklm-installer',
  )
  const payloadDir = join(ROOT, 'release', 'linux-unpacked')
  const licenseFile = join(ROOT, 'LICENSE')

  await requireFile(wizardBin, 'wizard binary ( cargo build first )')
  await requireFile(payloadDir, 'payload dir ( pnpm package:linux:payload first )')
  await requireFile(licenseFile, 'LICENSE')

  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  const version = pkg.version
  const outputFile = join(ROOT, 'release', `LokLM-Setup-${version}-linux-x64.run`)

  // Stage : assemble the directory layout the wizard expects at runtime.
  //   <stage>/installer/loklm-installer  ← Tauri binary
  //   <stage>/installer/LICENSE          ← read by get_license()
  //   <stage>/linux-unpacked/            ← LokLM payload
  //   <stage>/run-install.sh             ← makeself entry point
  const stage = join(ROOT, 'release', '.installer-stub-staging-linux')
  if (existsSync(stage)) await rm(stage, { recursive: true, force: true })
  await mkdir(join(stage, 'installer'), { recursive: true })
  await cp(wizardBin, join(stage, 'installer', 'loklm-installer'))
  await chmod(join(stage, 'installer', 'loklm-installer'), 0o755)
  await cp(licenseFile, join(stage, 'installer', 'LICENSE'))
  await cp(payloadDir, join(stage, 'linux-unpacked'), { recursive: true })

  // Entry script invoked by makeself after extraction. The wizard exec
  // takes over the process — we exec ( not spawn ) so the makeself
  // wrapper's exit code propagates from the wizard.
  const runScript = '#!/usr/bin/env bash\nset -e\nexec "$(dirname "$0")/installer/loklm-installer"\n'
  await writeFile(join(stage, 'run-install.sh'), runScript)
  await chmod(join(stage, 'run-install.sh'), 0o755)

  const makeself = await findMakeself()
  console.log(`makeself : ${makeself}`)
  console.log(`stage    : ${stage}`)
  console.log(`output   : ${outputFile}`)
  console.log('packaging .run ...')

  // makeself flags :
  //   --gzip      : zlib stream ( fast on Linux , 30-50% ratio for our
  //                  payload — same as our NSIS zlib for Windows )
  //   --notemp    : extract to a per-run tmpdir managed by makeself
  //   --nox11     : don't auto-spawn an xterm for output ; the wizard
  //                  takes over the UI itself
  //   --quiet     : suppress the "Verifying integrity" banner — the
  //                  Tauri wizard's boot-splash provides the feedback
  await new Promise((resolve, reject) => {
    const child = spawn(
      makeself,
      [
        '--gzip',
        '--notemp',
        '--nox11',
        '--quiet',
        stage,
        outputFile,
        'LokLM Installer',
        './run-install.sh',
      ],
      { stdio: 'inherit' },
    )
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`makeself exited with ${code}`)),
    )
  })

  if (!existsSync(outputFile)) {
    throw new Error(`makeself returned 0 but ${outputFile} is missing`)
  }
  const size = statSync(outputFile).size
  console.log(`built ${outputFile} ( ${(size / 1024 / 1024).toFixed(1)} MB )`)
}

main().catch((err) => {
  console.error(err.stack || err.message)
  process.exit(1)
})
