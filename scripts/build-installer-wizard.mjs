// Builds the Tauri wizard binary.
//
// Platform behavior :
//   - Linux : `cargo tauri build --bundles deb` — produces the wizard
//     binary AND a Debian package ( consumed by build-installer-deb-linux.mjs ).
//     The .run installer is still produced separately by the makeself stub ;
//     the .deb is the new , distribution-friendly artefact.
//   - Windows / macOS : `cargo tauri build --no-bundle` — Tauri's bundler
//     is bypassed because we ship via NSIS ( win ) / create-dmg ( mac ).
//
// Why a node wrapper instead of a direct `cd ... && cargo ...` in
// package.json :
//   - rustup's default install ( and the one we did locally ) does NOT
//     modify the user's PATH , so `cargo` isn't reachable from a fresh
//     pnpm shell. We prepend %USERPROFILE%\.cargo\bin defensively.
//   - cross-platform : keeps the same script working on macOS / Linux
//     where ~/.cargo/bin lives elsewhere , and where cargo is usually
//     already on PATH.
//   - exit codes propagate cleanly so the parent pnpm chain stops on
//     a build failure.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const WIZARD_DIR = join(ROOT, 'installer-wizard', 'src-tauri')

function cargoBinDir() {
  const home = process.env.USERPROFILE || process.env.HOME
  if (!home) return null
  const candidate = join(home, '.cargo', 'bin')
  return existsSync(candidate) ? candidate : null
}

const env = { ...process.env }
const cargoBin = cargoBinDir()
if (cargoBin) {
  env.PATH = `${cargoBin}${delimiter}${env.PATH || ''}`
}

const tauriArgs =
  process.platform === 'linux'
    ? ['tauri', 'build', '--bundles', 'deb']
    : ['tauri', 'build', '--no-bundle']

const child = spawn('cargo', tauriArgs, {
  cwd: WIZARD_DIR,
  stdio: 'inherit',
  env,
  // Windows : spawn cargo.exe via shell so PATH lookups resolve the .exe
  // extension correctly. macOS/Linux : same setting , no harm.
  shell: true,
})

child.on('exit', (code) => {
  process.exit(code ?? 1)
})
child.on('error', (err) => {
  console.error(`failed to spawn cargo : ${err.message}`)
  console.error('install rust via https://rustup.rs/ and cargo install tauri-cli --version ^2.0')
  process.exit(1)
})
