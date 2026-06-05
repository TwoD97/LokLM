// Signs Windows PE files (.exe / .dll) with a Certum code-signing certificate
// via the Windows SDK signtool.
//
// DISABLED BY DEFAULT. With LOKLM_SIGN unset every build behaves exactly as
// before — this module logs a skip and returns. That keeps dev builds and
// unsigned CI builds working with zero config. Set LOKLM_SIGN=1 to turn it on.
//
// Certum delivers the private key on hardware — either the SimplySign cloud
// HSM or a USB cryptographic token. Either way the certificate becomes usable
// by signtool through the Windows certificate store, so the command below is
// the SAME for both delivery methods. What differs is only how you make the
// key present at signing time:
//   - SimplySign cloud: install & sign in to SimplySign Desktop first; it
//     mounts a virtual smart-card reader exposing the cert.
//   - USB token: plug it in (proCertum CardManager / the token's CSP exposes
//     the cert to the Windows store).
//
// Resulting invocation:
//   signtool sign /v /fd SHA256 /tr http://time.certum.pl /td SHA256 \
//     /sha1 <CERTUM_THUMBPRINT>  <files...>
//
// Env knobs (one of THUMBPRINT / SUBJECT is required once enabled):
//   LOKLM_SIGN=1                enable signing
//   CERTUM_THUMBPRINT=...       SHA-1 thumbprint of the cert (preferred — exact)
//   CERTUM_SUBJECT=...          cert subject substring (signtool /n) if no thumbprint
//   CERTUM_TIMESTAMP_URL=...    RFC3161 timestamp authority (default below;
//                               verify against Certum's current TSA)
//   SIGNTOOL=...               full path to signtool.exe
//
// CLI (handy once the cert is in the store):
//   node scripts/sign-windows.mjs <file> [file...]

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)

const DEFAULT_TIMESTAMP_URL = 'http://time.certum.pl'

const SIGNTOOL_SDK_CANDIDATES = [
  'C:\\Program Files (x86)\\Windows Kits\\10\\bin\\x64\\signtool.exe',
  'C:\\Program Files (x86)\\Windows Kits\\10\\App Certification Kit\\signtool.exe',
]

export function signingEnabled() {
  return process.env.LOKLM_SIGN === '1'
}

async function findSigntool() {
  const override = process.env.SIGNTOOL
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`[sign] SIGNTOOL=${override} does not exist`)
    }
    return override
  }
  // PATH first. Invoking with no args exits non-zero but proves it resolves;
  // an ENOENT means it isn't on PATH.
  try {
    await execFileAsync('signtool', [], { windowsHide: true })
    return 'signtool'
  } catch (err) {
    if (err.code !== 'ENOENT') return 'signtool'
  }
  for (const p of SIGNTOOL_SDK_CANDIDATES) {
    if (existsSync(p)) return p
  }
  throw new Error(
    '[sign] signtool.exe not found on PATH or in the Windows SDK. Install the ' +
      'Windows SDK (Signing Tools) or set SIGNTOOL to its full path.',
  )
}

// Signs the given files in place. No-op (returns { skipped: true }) unless
// LOKLM_SIGN=1. Throws on any signing failure so the build chain stops.
export async function signWindows(files, { label = 'files' } = {}) {
  const targets = (Array.isArray(files) ? files : [files]).filter(Boolean)

  if (!signingEnabled()) {
    console.log(`[sign] LOKLM_SIGN not set — skipping ${label} (${targets.length} target(s))`)
    return { skipped: true, signed: 0 }
  }

  if (process.platform !== 'win32') {
    throw new Error('[sign] LOKLM_SIGN=1 but not on Windows; signtool requires Windows')
  }

  const missing = targets.filter((f) => !existsSync(f))
  if (missing.length) {
    throw new Error(`[sign] cannot sign — missing file(s): ${missing.join(', ')}`)
  }
  if (targets.length === 0) {
    console.warn(`[sign] no files to sign for ${label}`)
    return { skipped: false, signed: 0 }
  }

  const thumbprint = process.env.CERTUM_THUMBPRINT
  const subject = process.env.CERTUM_SUBJECT
  if (!thumbprint && !subject) {
    throw new Error(
      '[sign] LOKLM_SIGN=1 but neither CERTUM_THUMBPRINT nor CERTUM_SUBJECT is set ' +
        '(one is required so signtool knows which cert to use)',
    )
  }

  const timestampUrl = process.env.CERTUM_TIMESTAMP_URL || DEFAULT_TIMESTAMP_URL
  const signtool = await findSigntool()
  const selector = thumbprint ? ['/sha1', thumbprint] : ['/n', subject]

  const args = [
    'sign',
    '/v',
    '/fd',
    'SHA256',
    '/tr',
    timestampUrl,
    '/td',
    'SHA256',
    ...selector,
    ...targets,
  ]

  const who = thumbprint ? `thumbprint ${thumbprint.slice(0, 12)}…` : `subject "${subject}"`
  console.log(
    `[sign] ${label}: signing ${targets.length} file(s) with Certum (${who}) ts=${timestampUrl}`,
  )

  const { stdout, stderr } = await execFileAsync(signtool, args, {
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  })
  if (stderr && stderr.trim()) console.error(stderr)
  const tail = stdout.split(/\r?\n/).slice(-6).join('\n')
  if (tail.trim()) console.log(tail)

  return { skipped: false, signed: targets.length }
}

const __filename = fileURLToPath(import.meta.url)
const invoked = process.argv[1] && resolve(process.argv[1]) === resolve(__filename)
if (invoked) {
  const files = process.argv.slice(2)
  if (files.length === 0) {
    console.error('usage : node scripts/sign-windows.mjs <file> [file...]')
    process.exit(2)
  }
  signWindows(files, { label: 'cli' })
    .then((r) => {
      if (r.skipped) console.log('[sign] (disabled — set LOKLM_SIGN=1 to actually sign)')
    })
    .catch((err) => {
      console.error(err.stack || err.message)
      process.exit(1)
    })
}
