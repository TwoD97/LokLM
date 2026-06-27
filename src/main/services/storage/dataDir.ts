// Resolves the root directory for the encrypted vault (`loklm.vault`) + the
// per-workspace stores (`workspaces/`). Chosen 2026-06-27: data is PORTABLE by
// default — it lives next to the executable (the drive the user picked at
// install) so "install on drive X" puts your data on drive X, co-located with
// the install-relative `models/` dir. Several cases force userData instead:
//
//   - LOKLM_DATA_DIR env override        → always wins (power users / scale tests)
//   - dev (execPath = node_modules/electron) → userData (don't write into the repo)
//   - macOS (signed, read-only .app bundle) → userData (can't write beside it)
//   - an existing vault already in userData  → userData (never strand an existing
//                                              install's data; portable applies to
//                                              FRESH installs only)
//   - install dir not writable (Program Files w/o elevation) → userData
//
// The policy is pure; the two filesystem facts it needs (is the install dir
// writable, does userData already hold a vault) are injected so it is unit-
// testable without an electron runtime — same shape as TierMarker.

import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const VAULT_FILENAME = 'loklm.vault'

export interface DataDirEnv {
  /** process.env.LOKLM_DATA_DIR — an explicit override that wins over everything. */
  override?: string | undefined
  /** app.isPackaged — false in dev / vitest. */
  isPackaged: boolean
  /** process.platform. */
  platform: NodeJS.Platform
  /** process.execPath — the running binary; its dir is the install dir when packaged. */
  execPath: string
  /** app.getPath('userData') — the per-user fallback location. */
  userDataDir: string
}

export interface DataDirProbes {
  /** True if `dir` exists-or-can-be-created AND is writable. */
  isWritableDir: (dir: string) => boolean
  /** True if a vault file already lives directly under `userDataDir`. */
  vaultExists: (userDataDir: string) => boolean
}

export const defaultProbes: DataDirProbes = {
  isWritableDir(dir: string): boolean {
    try {
      mkdirSync(dir, { recursive: true })
      const probe = join(dir, `.lok-write-probe-${process.pid}`)
      writeFileSync(probe, '')
      unlinkSync(probe)
      return true
    } catch {
      return false
    }
  },
  vaultExists(userDataDir: string): boolean {
    return existsSync(join(userDataDir, VAULT_FILENAME))
  },
}

/** The directory directly containing the running executable (the install dir on
 *  packaged Windows/Linux). */
export function installDir(execPath: string): string {
  return dirname(execPath)
}

/**
 * Resolves the vault + workspaces root per the policy above. Returns an absolute
 * directory path; the caller ensures it exists before writing.
 */
export function resolveDataDir(env: DataDirEnv, probes: DataDirProbes = defaultProbes): string {
  const override = env.override?.trim()
  if (override) return override

  // Dev or macOS → userData (can't / shouldn't write next to the binary).
  if (!env.isPackaged || env.platform === 'darwin') return env.userDataDir

  // Existing install: a vault already in userData keeps using userData so an
  // upgrade to the portable build never strands the user's data.
  if (probes.vaultExists(env.userDataDir)) return env.userDataDir

  // Fresh install → next to the executable, when that location is writable.
  const portable = join(installDir(env.execPath), 'data')
  return probes.isWritableDir(portable) ? portable : env.userDataDir
}
