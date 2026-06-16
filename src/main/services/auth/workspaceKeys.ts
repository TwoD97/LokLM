import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { intoSecure, secureWipe } from './secureMemory'

// Per-workspace key envelope (ADR-0005), layered on the vault envelope of
// ADR-0002.
//
//   master DEK (32 B, install-lifetime, wrapped under password + recovery KEKs)
//        │  wraps
//        ▼
//   WDEK_workspace[i] (32 B, one per workspace)  ── encrypts that workspace's
//        block-encrypted vector store + metadata files
//
// Why a second key layer rather than encrypting every workspace under the
// master DEK directly:
//   - Independent loading: opening one workspace only needs to unwrap that
//     workspace's WDEK, not touch any other workspace's key material.
//   - Per-workspace lifecycle: deleting a workspace = forgetting its WDEK +
//     dropping its files; no re-encrypt of anything else.
//   - Same recovery story for free: the master DEK is recoverable via the
//     existing 18-word passphrase, so every WDEK it wraps is too — no new
//     recovery channel to design.
//
// This is the standard hierarchical-key pattern: 1Password ("Account Unlock
// Key" → per-"Vault" keys) and AWS KMS (CMK → per-object data keys) both wrap
// a per-scope data key under one root key for exactly these properties.
//
// The wrapped WDEK lives in the vault manifest (see src/shared/workspaceStorage
// VaultManifest), itself stored inside the encrypted vault body, so the wrap is
// defence in depth rather than the only barrier.

const AES_ALGO = 'aes-256-gcm' as const
const NONCE_BYTES = 12
const TAG_BYTES = 16
export const WDEK_BYTES = 32

/** A WDEK encrypted under the master DEK. base64 fields mirror AuthService's
 *  WrappedKey so the manifest serialises the same way the auth header does. */
export interface WrappedWorkspaceKey {
  nonce: string // base64(12) — AES-GCM nonce
  ciphertext: string // base64(32 + 16) — WDEK ‖ GCM auth tag
}

/** Wraps an existing WDEK under the master DEK. Caller owns `wdek`'s lifetime;
 *  this does not wipe it. */
export function wrapWorkspaceKey(masterDek: Buffer, wdek: Buffer): WrappedWorkspaceKey {
  if (masterDek.length !== 32) throw new Error('master DEK must be 32 bytes')
  if (wdek.length !== WDEK_BYTES) throw new Error(`WDEK must be ${WDEK_BYTES} bytes`)
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv(AES_ALGO, masterDek, nonce, { authTagLength: TAG_BYTES })
  const ct = Buffer.concat([cipher.update(wdek), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    nonce: nonce.toString('base64'),
    ciphertext: Buffer.concat([ct, tag]).toString('base64'),
  }
}

/**
 * Generates a fresh WDEK and returns it (in mlock'd memory) alongside its
 * wrapped form for the manifest. The plaintext WDEK is what the block cipher
 * uses for the session; the wrapped form is what gets persisted.
 */
export function createWorkspaceKey(masterDek: Buffer): {
  wdek: Buffer
  wrapped: WrappedWorkspaceKey
} {
  const wdek = intoSecure(randomBytes(WDEK_BYTES))
  const wrapped = wrapWorkspaceKey(masterDek, wdek)
  return { wdek, wrapped }
}

/**
 * Unwraps a WDEK with the master DEK. Returns the WDEK in mlock'd memory, or
 * null when the tag check fails (wrong/rotated master DEK, or tampered
 * manifest). Null rather than throw mirrors AuthService.unwrapKey so the same
 * "wrong secret" handling applies.
 */
export function unwrapWorkspaceKey(masterDek: Buffer, wrapped: WrappedWorkspaceKey): Buffer | null {
  try {
    if (masterDek.length !== 32) return null
    const nonce = Buffer.from(wrapped.nonce, 'base64')
    const blob = Buffer.from(wrapped.ciphertext, 'base64')
    if (blob.length !== WDEK_BYTES + TAG_BYTES) return null
    const ct = blob.subarray(0, WDEK_BYTES)
    const tag = blob.subarray(WDEK_BYTES)
    const decipher = createDecipheriv(AES_ALGO, masterDek, nonce, { authTagLength: TAG_BYTES })
    decipher.setAuthTag(tag)
    const out = Buffer.concat([decipher.update(ct), decipher.final()])
    return intoSecure(out)
  } catch {
    return null
  }
}

/** Convenience for workspace deletion: wipe a live WDEK from memory. */
export function disposeWorkspaceKey(wdek: Buffer | null): void {
  if (wdek) secureWipe(wdek)
}
