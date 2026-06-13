import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto'
import argon2 from 'argon2'
import { intoSecure, secureWipe } from './secureMemory'
import { Database } from '../../db/database'
import {
  generatePassphrase as generatePassphraseShared,
  normalisePassphrase as normalisePassphraseShared,
  validatePassphrase as validatePassphraseShared,
  validatePassword as validatePasswordShared,
  getWordlist,
  PASSPHRASE_WORDS,
  type WordlistLang,
} from '../../../shared/authHelpers'
import type {
  AuthLoginStage,
  AuthStatus,
  LoginResult,
  ResetResult,
} from '../../../shared/authTypes'

// vault layout v4 , one file on disk:
//
//   MAGIC          8 bytes   "LOKLM04\0"
//   HEADER_LEN     4 bytes   big-endian uint32
//   HEADER_JSON    N bytes   utf-8 json , AuthHeader (wrapped DEKs , salts , displayName)
//   BODY_NONCE    12 bytes   AES-GCM nonce for the snapshot ciphertext
//   BODY_TAG      16 bytes   AES-GCM auth tag
//   BODY_CIPHER   rest       AES-256-GCM(DEK) of the pglite tar dump
//
// why one file: wrapped DEK and ciphertext live or die together. if the
// header gets deleted or quarantined the snapshot is gone even with the
// right password or passphrase , so splitting them gains nothing and adds
// a failure mode. atomic rename keeps header and body in sync , and
// backups are just one file to copy.
//
// crash safety , two layers (mechanics in writeVaultNow):
//   1. tmp-write + fsync + rename — the new bytes are durable on disk before
//      the rename exists , so the primary is always either the old or the new
//      generation , never a torn mix. covers app crash AND power loss.
//   2. loklm.vault.bak — byte-copy of the last successful persist , written
//      after the primary swap. read fallback when the primary goes missing
//      (av quarantine , manual delete) or fails structure/tag checks (bit
//      rot). to truly start over both files have to be deleted.
//
// crypto layers (same as v3):
//   - DEK , 32 random bytes , encrypts the snapshot body
//   - DEK is wrapped twice with AES-256-GCM under two independent KEKs ,
//     one from the password , one from an 18-word BIP-39 style passphrase
//   - each KEK = argon2id(secret , salt , 32 byte raw output)
//   - DEK stays the same for the whole install. on password reset we just
//     re-wrap it under fresh KEKs and re-encrypt the body with a new nonce ,
//     so library content survives the recovery flow.
interface AuthHeader {
  version: 4
  displayName: string
  passwordSalt: string // base64(32) — KEK derivation salt for password
  passwordWrappedDek: WrappedKey // DEK encrypted under password-KEK
  recoveryEntries: RecoveryEntry[] // length 1 in v4
  recoveryLang: WordlistLang
  createdAt: number
}

interface RecoveryEntry {
  salt: string // base64(32) — KEK derivation salt for this code
  wrappedDek: WrappedKey // DEK encrypted under this recovery code's KEK
  createdAt: number
  usedAt: number | null
}

interface WrappedKey {
  nonce: string // base64(12) — AES-GCM nonce
  ciphertext: string // base64(32 + 16) — DEK + GCM auth tag
}

interface EncryptedBody {
  nonce: Buffer // 12 bytes
  tag: Buffer // 16 bytes
  /** Cipher chunks (cipher.update + cipher.final). Kept as an array so writeVault
   *  can spread them into its outer Buffer.concat — one Buffer.concat instead of
   *  the two we used to do (chunks → ciphertext → final out blob). Concatenated
   *  size identical to a single ciphertext Buffer. */
  ciphertextChunks: Buffer[]
}

export type { AuthStatus, LoginResult, ResetResult }

const ARGON_OPTS = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB , per Pflichtenheft 3.1.1
  timeCost: 3,
  parallelism: 4,
  hashLength: 32,
  raw: true as const,
}

const AES_ALGO = 'aes-256-gcm' as const
const AES_NONCE_BYTES = 12
const AES_TAG_BYTES = 16
const VAULT_MAGIC = Buffer.from('LOKLM04\0') // 8 bytes , bump when the on-disk layout changes
const HEADER_LEN_BYTES = 4
const HEADER_OFFSET = VAULT_MAGIC.length + HEADER_LEN_BYTES

const DEK_BYTES = 32
const KEK_SALT_BYTES = 32

// Pflichtenheft 3.1.2 , 5 fails → 5 min lockout , in-memory only.
const MAX_FAIL_ATTEMPTS = 5
const FAIL_LOCKOUT_MS = 5 * 60 * 1000

// Pflichtenheft 3.1.4 , 15 min default inactivity lock.
const DEFAULT_INACTIVITY_MS = 15 * 60 * 1000

/** Thrown by requireDatabase() when the session is locked. Detect on the
 *  caller side via `instanceof LockedError` (in-process) or
 *  `err.code === 'LOCKED'` (across the Electron IPC boundary , `instanceof`
 *  doesn't survive serialization but `.code` does). */
export class LockedError extends Error {
  readonly code = 'LOCKED'
  constructor(message = 'locked') {
    super(message)
    this.name = 'LockedError'
  }
}

export function isLockedError(err: unknown): boolean {
  if (err instanceof LockedError) return true
  if (err && typeof err === 'object') {
    const e = err as { code?: unknown; name?: unknown }
    if (e.code === 'LOCKED' || e.name === 'LockedError') return true
  }
  return false
}

/**
 * AuthService owns the boot-time auth state , the encrypted vault lifecycle ,
 * and the in-memory DEK. the Database instance only exists between
 * login()/register() and lock()/logout().
 *
 * files under userData/:
 *   loklm.vault       one file , header (wrapped DEKs + metadata) + AES-GCM(DEK)(pglite tar dump)
 *   loklm.vault.bak   byte-copy of the last successful persist , read fallback (see writeVaultNow)
 */
export class AuthService {
  private readonly vaultFilePath: string
  private readonly vaultBackupPath: string

  // live session state , only set between login()/register() and lock().
  // liveHeader doubles as a "is the vault on disk?" answer for status() while
  // a session is open , so we don't reread 10 MB on every renderer state push.
  // when no session is live, status() always hits disk fresh , otherwise a
  // deleted/quarantined vault would keep showing the login screen forever.
  private dek: Buffer | null = null
  private database: Database | null = null
  private liveHeader: AuthHeader | null = null
  private lastActivity = Date.now()
  private inactivityMs = DEFAULT_INACTIVITY_MS
  private inactivityTimer: NodeJS.Timeout | null = null
  private onLockCallback: (() => void) | null = null
  // Optional guard the auto-lock timer consults before firing. Returning true
  // suppresses the lock and resets the idle clock — used to pause auto-lock
  // while a long background task (e.g. a multi-GB model download) is running.
  private inactivityGuard: (() => boolean) | null = null

  // brute-force tracker for login.
  private failures: number[] = []

  // Serializes vault writes — see writeVault. Without this, two overlapping
  // persists race on the shared loklm.vault.tmp file.
  private vaultWriteChain: Promise<void> = Promise.resolve()

  constructor(userDataDir: string) {
    this.vaultFilePath = join(userDataDir, 'loklm.vault')
    this.vaultBackupPath = this.vaultFilePath + '.bak'
  }

  // -------------------------------------------------------------------------
  // public surface
  // -------------------------------------------------------------------------

  async status(): Promise<AuthStatus> {
    const a = await this.loadHeader()
    if (!a) {
      return {
        registered: false,
        locked: true,
        displayName: null,
        remainingRecoveryCodes: 0,
        recoveryLang: null,
      }
    }
    return {
      registered: true,
      locked: this.dek === null,
      displayName: a.displayName,
      remainingRecoveryCodes: a.recoveryEntries.filter((r) => r.usedAt == null).length,
      recoveryLang: a.recoveryLang,
    }
  }

  async register(input: {
    displayName: string
    password: string
    recoveryLang: WordlistLang
  }): Promise<{ passphrase: string[] }> {
    if (await this.loadHeader()) {
      throw new Error('A user is already registered on this installation.')
    }
    if (input.recoveryLang !== 'de' && input.recoveryLang !== 'en') {
      throw new Error('recoveryLang must be "de" or "en".')
    }
    validatePassword(input.password)
    const displayName = input.displayName.trim()
    if (displayName.length < 3 || displayName.length > 32) {
      throw new Error('Display name must be 3–32 characters.')
    }

    // Session-lifetime key → guarded + mlock'd memory from the start , so it
    // can never be paged out to disk. ( intoSecure wipes the randomBytes temp. )
    const dek = intoSecure(randomBytes(DEK_BYTES))

    const passwordSalt = randomBytes(KEK_SALT_BYTES)
    const passwordKek = await deriveKEK(input.password, Buffer.from(passwordSalt))
    const passwordWrappedDek = wrapKey(passwordKek, dek)
    secureWipe(passwordKek)

    // one recovery entry , derived from the canonicalized passphrase.
    const wordlist = getWordlist(input.recoveryLang)
    const passphrase = generatePassphraseShared(wordlist, PASSPHRASE_WORDS, randomBytes)
    const recoverySalt = randomBytes(KEK_SALT_BYTES)
    const recoveryKek = await deriveKEK(passphrase.join(' '), Buffer.from(recoverySalt))
    const recoveryEntry: RecoveryEntry = {
      salt: recoverySalt.toString('base64'),
      wrappedDek: wrapKey(recoveryKek, dek),
      createdAt: nowSec(),
      usedAt: null,
    }
    secureWipe(recoveryKek)

    const header: AuthHeader = {
      version: 4,
      displayName,
      passwordSalt: passwordSalt.toString('base64'),
      passwordWrappedDek,
      recoveryEntries: [recoveryEntry],
      recoveryLang: input.recoveryLang,
      createdAt: nowSec(),
    }

    this.dek = dek
    this.database = await Database.create(undefined)
    const body = await this.encryptCurrentDb(dek)
    await this.writeVault(header, body)
    this.liveHeader = header
    this.startInactivityTimer()
    return { passphrase }
  }

  async login(
    password: string,
    opts: { onProgress?: (stage: AuthLoginStage) => void } = {},
  ): Promise<LoginResult> {
    const emit = (stage: AuthLoginStage): void => {
      try {
        opts.onProgress?.(stage)
      } catch {
        /* progress is diagnostic only , never block login on a listener throw */
      }
    }
    const vault = await this.readVault()
    if (!vault) return { ok: false, reason: 'no_user' }

    const cooldown = this.cooldownRemainingMs()
    if (cooldown > 0) return { ok: false, reason: 'rate_limited', retryAfterMs: cooldown }

    emit('deriving')
    const passwordSalt = Buffer.from(vault.header.passwordSalt, 'base64')
    const passwordKek = await deriveKEK(password, Buffer.from(passwordSalt))
    const dek = unwrapKey(passwordKek, vault.header.passwordWrappedDek)
    secureWipe(passwordKek)

    if (!dek) {
      this.recordFailure()
      return { ok: false, reason: 'bad_password' }
    }

    // got the DEK , now decrypt the body. with single-file vaults the header
    // and body live together so any failure here is just file corruption ,
    // not an auth/snapshot drift.
    emit('decrypting')
    let snapshotBlob = decryptBody(vault.body, dek)
    if (snapshotBlob == null && vault.source === 'primary') {
      // primary body failed its gcm tag. the DEK is install-lifetime , it
      // opens any generation's body — so the backup can rescue the last good
      // persist even though we keep the primary's (intact) header for the
      // session. the next persist rewrites both files and self-heals.
      const backup = await this.readBackupQuiet()
      if (backup) {
        snapshotBlob = decryptBody(backup.body, dek)
        if (snapshotBlob != null) {
          console.warn(
            '[auth] vault body corrupt , restored last good generation from loklm.vault.bak',
          )
        }
      }
    }
    if (snapshotBlob == null) {
      secureWipe(dek)
      throw new Error(
        'Vault body failed to decrypt and no usable backup exists — file is corrupt. Restore from an external backup if available.',
      )
    }

    emit('restoring')
    // Only commit the DEK to session state once the DB actually loads. If
    // Database.create throws (incompatible/corrupt snapshot that still passed
    // the GCM tag, migration failure), zero the DEK rather than leaving it
    // resident — matches the zeroing on every other failure path here.
    let database: Database
    try {
      database = await Database.create(undefined, snapshotBlob)
    } catch (err) {
      secureWipe(dek)
      throw err
    }
    this.dek = dek
    this.database = database
    this.liveHeader = vault.header
    this.failures = []
    this.startInactivityTimer()
    emit('ready')
    return { ok: true }
  }

  /** Re-runs argon2id + tries the DEK unwrap against the supplied password
   *  without touching session state. Used as a confirmation gate before
   *  destructive / exfiltrating actions (document export , flipping the
   *  Ollama connector to a non-loopback host , ...). Honors the same
   *  brute-force lockout as login so the gate can't be used as an
   *  unlimited oracle. Returns:
   *    { ok: true }                          — password matched
   *    { ok: false, reason: 'no_user' }      — no vault on disk
   *    { ok: false, reason: 'locked_session' } — session is locked
   *    { ok: false, reason: 'rate_limited', retryAfterMs }
   *    { ok: false, reason: 'bad_password' } */
  async verifyPassword(
    password: string,
  ): Promise<
    | { ok: true }
    | { ok: false; reason: 'no_user' | 'locked_session' | 'bad_password' }
    | { ok: false; reason: 'rate_limited'; retryAfterMs: number }
  > {
    if (!this.isUnlocked()) return { ok: false, reason: 'locked_session' }
    const header = this.liveHeader
    if (!header) return { ok: false, reason: 'no_user' }
    const cooldown = this.cooldownRemainingMs()
    if (cooldown > 0) return { ok: false, reason: 'rate_limited', retryAfterMs: cooldown }
    const salt = Buffer.from(header.passwordSalt, 'base64')
    const kek = await deriveKEK(password, salt)
    const probe = unwrapKey(kek, header.passwordWrappedDek)
    secureWipe(kek)
    if (!probe) {
      this.recordFailure()
      return { ok: false, reason: 'bad_password' }
    }
    // got the DEK , zero it immediately , the verify only confirms identity.
    secureWipe(probe)
    this.touch()
    return { ok: true }
  }

  async lock(): Promise<void> {
    if (!this.dek || !this.database) return
    try {
      await this.persistSnapshot()
    } finally {
      await this.shutdownDatabase()
      this.zeroKey()
      this.stopInactivityTimer()
      this.liveHeader = null
    }
  }

  async logout(): Promise<void> {
    // same as lock , single-user app , no identity switching here.
    await this.lock()
  }

  async reset(input: { passphrase: string; newPassword: string }): Promise<ResetResult> {
    const vault = await this.readVault()
    if (!vault) return { ok: false, reason: 'no_user' }
    const cooldown = this.cooldownRemainingMs()
    if (cooldown > 0) return { ok: false, reason: 'rate_limited', retryAfterMs: cooldown }

    validatePassword(input.newPassword)

    // early reject on bad shape / unknown words , so we dont burn argon2 or a rate-limit slot.
    const wordlist = getWordlist(vault.header.recoveryLang)
    const words = normalisePassphraseShared(input.passphrase).split(' ')
    const check = validatePassphraseShared(words, wordlist)
    if (!check.ok) return { ok: false, reason: 'bad_code' }

    let dek: Buffer | null = null
    let matchedIdx = -1
    for (let i = 0; i < vault.header.recoveryEntries.length; i++) {
      const entry = vault.header.recoveryEntries[i]
      if (!entry || entry.usedAt != null) continue
      const salt = Buffer.from(entry.salt, 'base64')
      const kek = await deriveKEK(words.join(' '), salt)
      const candidate = unwrapKey(kek, entry.wrappedDek)
      secureWipe(kek)
      if (candidate) {
        dek = candidate
        matchedIdx = i
        break
      }
    }
    if (!dek) {
      this.recordFailure()
      return { ok: false, reason: 'bad_code' }
    }

    // re-wrap the same DEK under a new password-KEK and mint a fresh
    // passphrase , same recoveryLang as at registration.
    const newPasswordSalt = randomBytes(KEK_SALT_BYTES)
    const newPasswordKek = await deriveKEK(input.newPassword, Buffer.from(newPasswordSalt))
    const newPasswordWrappedDek = wrapKey(newPasswordKek, dek)
    secureWipe(newPasswordKek)

    const newPassphrase = generatePassphraseShared(wordlist, PASSPHRASE_WORDS, randomBytes)
    const newRecoverySalt = randomBytes(KEK_SALT_BYTES)
    const newRecoveryKek = await deriveKEK(newPassphrase.join(' '), Buffer.from(newRecoverySalt))
    const newEntry: RecoveryEntry = {
      salt: newRecoverySalt.toString('base64'),
      wrappedDek: wrapKey(newRecoveryKek, dek),
      createdAt: nowSec(),
      usedAt: null,
    }
    secureWipe(newRecoveryKek)

    const newHeader: AuthHeader = {
      ...vault.header,
      passwordSalt: newPasswordSalt.toString('base64'),
      passwordWrappedDek: newPasswordWrappedDek,
      recoveryEntries: [newEntry],
    }
    const usedEntry = vault.header.recoveryEntries[matchedIdx]
    if (usedEntry) usedEntry.usedAt = nowSec()

    // Fail closed on an undecryptable body — same guard login() uses. Without
    // this a corrupt body (decryptBody → null) would fall through to a FRESH
    // EMPTY database and writeVault would then overwrite the still-recoverable
    // ciphertext with that empty snapshot — i.e. the recovery flow would wipe
    // the very data it exists to save. Try the .bak generation first (the DEK
    // is install-lifetime , it opens any generation's body); if that fails too
    // an external backup is the only path left , so we must not touch the file.
    let snapshotBlob = decryptBody(vault.body, dek)
    if (snapshotBlob == null && vault.source === 'primary') {
      const backup = await this.readBackupQuiet()
      if (backup) {
        snapshotBlob = decryptBody(backup.body, dek)
        if (snapshotBlob != null) {
          console.warn(
            '[auth] vault body corrupt , reset continues from the loklm.vault.bak generation',
          )
        }
      }
    }
    if (snapshotBlob == null) {
      secureWipe(dek)
      throw new Error(
        'Vault body failed to decrypt and no usable backup exists — file is corrupt. Restore from an external backup if available.',
      )
    }
    // Only commit the DEK once the DB actually loads ; zero it on any failure
    // rather than leaving key material resident (mirrors login()).
    let database: Database
    try {
      database = await Database.create(undefined, snapshotBlob)
    } catch (err) {
      secureWipe(dek)
      throw err
    }
    this.dek = dek
    this.database = database
    const newBody = await this.encryptCurrentDb(dek)
    await this.writeVault(newHeader, newBody)
    this.liveHeader = newHeader
    this.failures = []
    this.startInactivityTimer()
    return { ok: true, passphrase: newPassphrase }
  }

  /**
   * Changes the vault password on an unlocked session (AP-9 Account §3.8).
   * Re-wraps the live DEK under a fresh password-KEK; the encrypted body and the
   * recovery entries are left untouched, so recovery codes keep working. The
   * current password is required and verified via verifyPassword (which also
   * rate-limits a wrong guess), so a passer-by at an open session can't re-key
   * the vault without knowing it.
   */
  async changePassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<
    | { ok: true }
    | { ok: false; reason: 'locked_session' | 'no_user' | 'bad_password' }
    | { ok: false; reason: 'rate_limited'; retryAfterMs: number }
    | { ok: false; reason: 'weak_password'; message: string }
  > {
    const verified = await this.verifyPassword(currentPassword)
    if (!verified.ok) return verified

    try {
      validatePassword(newPassword)
    } catch (e) {
      return {
        ok: false,
        reason: 'weak_password',
        message: e instanceof Error ? e.message : String(e),
      }
    }

    // verifyPassword confirmed the session is unlocked, so dek + liveHeader are
    // both set; the guard is just to satisfy the type narrowing.
    if (!this.dek || !this.liveHeader) return { ok: false, reason: 'locked_session' }

    const newSalt = randomBytes(KEK_SALT_BYTES)
    const newKek = await deriveKEK(newPassword, Buffer.from(newSalt))
    const newWrappedDek = wrapKey(newKek, this.dek)
    secureWipe(newKek)

    // Build the re-keyed header as a candidate and only swap it into the live
    // session AFTER the write succeeds — mirroring reset()/register(). Mutating
    // this.liveHeader in place before the write would leave the session holding
    // the new wrap on a write failure; a later unrelated persist (auto-lock,
    // setDisplayName, settings autosave) would then silently commit a password
    // change the caller saw fail. recoveryEntries + DEK are left untouched, so
    // recovery codes keep working.
    const newHeader: AuthHeader = {
      ...this.liveHeader,
      passwordSalt: newSalt.toString('base64'),
      passwordWrappedDek: newWrappedDek,
    }
    const newBody = await this.encryptCurrentDb(this.dek)
    await this.writeVault(newHeader, newBody)
    this.liveHeader = newHeader
    return { ok: true }
  }

  /**
   * Mutates the in-memory AuthHeader displayName and re-persists the vault.
   * Throws on invalid input. No-op when locked.
   */
  async setDisplayName(name: string): Promise<void> {
    const trimmed = name.trim()
    if (trimmed.length === 0 || trimmed.length > 40) {
      throw new Error('displayName must be 1–40 chars after trim')
    }
    if (!this.isUnlocked()) return
    if (!this.liveHeader) throw new Error('vault header not loaded')
    this.liveHeader.displayName = trimmed
    await this.persistSnapshot()
  }

  // -------------------------------------------------------------------------
  // session helpers used by the IPC layer
  // -------------------------------------------------------------------------

  /** returns the live Database , throws LockedError when the session is locked.
   *  Callers can detect via `isLockedError(err)` (works across IPC). */
  requireDatabase(): Database {
    if (!this.database) {
      throw new LockedError()
    }
    this.touch()
    return this.database
  }

  isUnlocked(): boolean {
    return this.database !== null && this.dek !== null
  }

  touch(): void {
    this.lastActivity = Date.now()
  }

  setInactivityMs(ms: number): void {
    this.inactivityMs = Math.max(60_000, ms)
  }

  setOnLock(cb: () => void): void {
    this.onLockCallback = cb
  }

  /** Install a guard that, while it returns true, suppresses the inactivity
   *  auto-lock. The idle clock is reset on each skipped tick so locking
   *  resumes from a fresh 15 min the moment the guard returns false again. */
  setInactivityGuard(guard: (() => boolean) | null): void {
    this.inactivityGuard = guard
  }

  async persistSnapshotIfUnlocked(): Promise<void> {
    if (this.dek && this.database) {
      await this.persistSnapshot()
    }
  }

  // -------------------------------------------------------------------------
  // internal helpers
  // -------------------------------------------------------------------------

  private async loadHeader(): Promise<AuthHeader | null> {
    // during a live session the header is fixed in memory , no need to re-read.
    // when locked we always hit disk so a vault that got deleted/quarantined
    // outside the app stops being reported as "registered".
    if (this.liveHeader) return this.liveHeader
    const vault = await this.readVault()
    return vault?.header ?? null
  }

  /** primary vault with automatic fallback to loklm.vault.bak when the primary
   *  is missing or structurally broken. `source` tells callers which file the
   *  bytes came from , so the body-decrypt fallback in login()/reset() knows
   *  whether a backup retry is still worth attempting. null = no vault at all
   *  (not registered). throws when the primary is corrupt AND no usable backup
   *  exists — that error names the primary , the one worth reporting. */
  private async readVault(): Promise<{
    header: AuthHeader
    body: EncryptedBody
    source: 'primary' | 'backup'
  } | null> {
    let primaryErr: unknown = null
    try {
      const primary = await this.readVaultFrom(this.vaultFilePath)
      if (primary) return { ...primary, source: 'primary' }
    } catch (err) {
      primaryErr = err
    }
    const backup = await this.readBackupQuiet()
    if (backup) {
      console.warn(
        '[auth] primary vault missing or unreadable , serving loklm.vault.bak:',
        primaryErr ?? 'ENOENT',
      )
      return { ...backup, source: 'backup' }
    }
    if (primaryErr) throw primaryErr
    return null
  }

  /** backup read that never throws — a corrupt backup must not mask the
   *  primary's state , it just drops out as a fallback option. */
  private async readBackupQuiet(): Promise<{ header: AuthHeader; body: EncryptedBody } | null> {
    try {
      return await this.readVaultFrom(this.vaultBackupPath)
    } catch {
      return null
    }
  }

  private async readVaultFrom(
    path: string,
  ): Promise<{ header: AuthHeader; body: EncryptedBody } | null> {
    let raw: Buffer
    try {
      raw = await fs.readFile(path)
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null
      throw err
    }
    if (raw.length < HEADER_OFFSET) {
      throw new Error(`Vault file at ${path} is truncated (too short for header).`)
    }
    const magic = raw.subarray(0, VAULT_MAGIC.length)
    if (!timingSafeEqual(magic, VAULT_MAGIC)) {
      throw new Error(
        `Vault file at ${path} is not a LokLM v4 vault. Delete it to start over, or restore from a backup.`,
      )
    }
    const headerLen = raw.readUInt32BE(VAULT_MAGIC.length)
    const bodyOffset = HEADER_OFFSET + headerLen
    if (raw.length < bodyOffset + AES_NONCE_BYTES + AES_TAG_BYTES) {
      throw new Error(`Vault file at ${path} is truncated (header.len=${headerLen}).`)
    }
    const headerJson = raw.subarray(HEADER_OFFSET, bodyOffset).toString('utf8')
    let header: AuthHeader
    try {
      header = JSON.parse(headerJson) as AuthHeader
    } catch {
      throw new Error(`Vault header is not valid JSON in ${path}.`)
    }
    if (header.version !== 4) {
      throw new Error(
        `Vault header version ${header.version} is not supported by this build. Delete ${path} to start over.`,
      )
    }
    const nonce = raw.subarray(bodyOffset, bodyOffset + AES_NONCE_BYTES)
    const tag = raw.subarray(
      bodyOffset + AES_NONCE_BYTES,
      bodyOffset + AES_NONCE_BYTES + AES_TAG_BYTES,
    )
    const ciphertext = raw.subarray(bodyOffset + AES_NONCE_BYTES + AES_TAG_BYTES)
    // Single subarray view , no copy. Wrapped in an array so the body shape
    // is symmetric between read (where we have one big chunk) and write
    // (where we have cipher.update + cipher.final).
    return { header, body: { nonce, tag, ciphertextChunks: [ciphertext] } }
  }

  private writeVault(header: AuthHeader, body: EncryptedBody): Promise<void> {
    // Serialize writes. writeVaultNow uses a single fixed `.tmp` path, so two
    // overlapping writes (a settings:update persist racing an auto-lock or
    // before-quit persist) would interleave into that tmp and the second rename
    // would hit an already-moved tmp (ENOENT) or rename a mixed-content tmp over
    // the vault — an AES-GCM tag failure on next login that recovery codes can't
    // fix. The cross-process variant is handled by requestSingleInstanceLock;
    // this closes the in-process one. Chain off the previous write regardless of
    // its outcome so one failure doesn't wedge the queue, while still returning
    // the real result to this caller.
    const result = this.vaultWriteChain.then(
      () => this.writeVaultNow(header, body),
      () => this.writeVaultNow(header, body),
    )
    this.vaultWriteChain = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private async writeVaultNow(header: AuthHeader, body: EncryptedBody): Promise<void> {
    const headerJson = Buffer.from(JSON.stringify(header), 'utf8')
    const headerLen = Buffer.alloc(HEADER_LEN_BYTES)
    headerLen.writeUInt32BE(headerJson.length, 0)
    const out = Buffer.concat([
      VAULT_MAGIC,
      headerLen,
      headerJson,
      body.nonce,
      body.tag,
      ...body.ciphertextChunks,
    ])
    await fs.mkdir(dirname(this.vaultFilePath), { recursive: true })
    const tmp = this.vaultFilePath + '.tmp'
    // layer 1 , durability fence (closes the known limitation from the
    // security review 2026-06-10): fsync the tmp's data blocks BEFORE the
    // rename. without it ntfs/ext4 journal the rename ahead of the data
    // flush , and a power loss could leave a present , right-sized vault
    // that fails its gcm tag. with the fence the rename only ever swaps in
    // durable bytes — the primary is always either the old or the new
    // generation , never a torn mix. (a crash before the rename just leaves
    // a stale .tmp that the next attempt truncates.)
    await this.writeFileSynced(tmp, out)
    await fs.rename(tmp, this.vaultFilePath)
    // posix: fsync the directory so the rename itself survives power loss.
    // windows can't open directories — the FlushFileBuffers above is the
    // fence ntfs gives us , and a lost rename there still leaves the old
    // (valid) vault in place.
    await this.syncDir(dirname(this.vaultFilePath))
    // layer 2 , backup generation: same verified bytes again under .bak ,
    // written only after the primary swap succeeded. covers what the fence
    // can't — bit rot , av quarantine , a manually deleted primary. always
    // the SAME generation as the primary , so a password change re-keys the
    // backup in the same persist and the old password dies with it.
    // best-effort: a failed backup write must not fail the persist (the
    // primary is already live) , but a stale .bak must not linger either —
    // it could still open under pre-rekey credentials — so drop it on error.
    try {
      await this.writeFileSynced(this.vaultBackupPath, out)
    } catch (err) {
      console.warn('[auth] vault backup write failed , dropping loklm.vault.bak:', err)
      await fs.rm(this.vaultBackupPath, { force: true }).catch(() => undefined)
    }
  }

  /** write + fsync , data is durable on disk before the caller proceeds.
   *  goes through fs.writeFile(handle , ...) rather than handle.writeFile so
   *  the write-serialization test can keep spying on the fs.promises export. */
  private async writeFileSynced(path: string, data: Buffer): Promise<void> {
    const fh = await fs.open(path, 'w', 0o600)
    try {
      await fs.writeFile(fh, data)
      await fh.sync()
    } finally {
      await fh.close()
    }
  }

  private async syncDir(dir: string): Promise<void> {
    if (process.platform === 'win32') return
    try {
      const dh = await fs.open(dir, 'r')
      try {
        await dh.sync()
      } finally {
        await dh.close()
      }
    } catch {
      /* best-effort , not every filesystem lets you fsync a directory */
    }
  }

  private async persistSnapshot(): Promise<void> {
    if (!this.database || !this.dek || !this.liveHeader) {
      throw new Error('persistSnapshot called without a live session')
    }
    const body = await this.encryptCurrentDb(this.dek)
    await this.writeVault(this.liveHeader, body)
  }

  private async encryptCurrentDb(dek: Buffer): Promise<EncryptedBody> {
    if (!this.database) throw new Error('encryptCurrentDb called without a live database')
    const blob = await this.database.dump()
    // Buffer.from(ArrayBuffer) is a view , no copy of the bytes. We feed it
    // straight to cipher.update and skip the intermediate `plaintext` local +
    // the Buffer.concat of update/final. That used to triple-buffer the whole
    // snapshot at peak; now we keep just the cipher chunks + the final
    // writeVault concat.
    const plaintextView = Buffer.from(await blob.arrayBuffer())
    const nonce = randomBytes(AES_NONCE_BYTES)
    const cipher = createCipheriv(AES_ALGO, dek, nonce)
    const chunks = [cipher.update(plaintextView), cipher.final()]
    const tag = cipher.getAuthTag()
    return { nonce, tag, ciphertextChunks: chunks }
  }

  private async shutdownDatabase(): Promise<void> {
    const db = this.database
    this.database = null
    if (db) {
      try {
        await db.close()
      } catch {
        /* swallow close races , nothing we can do here */
      }
    }
  }

  private zeroKey(): void {
    if (this.dek) {
      secureWipe(this.dek)
      this.dek = null
    }
  }

  private startInactivityTimer(): void {
    this.stopInactivityTimer()
    this.lastActivity = Date.now()
    // tick every 30s , granularity is fine , we just need to spot expiry.
    this.inactivityTimer = setInterval(() => {
      if (!this.isUnlocked()) return
      // Guard active (e.g. a model download in flight) — touch activity so we
      // start the idle window fresh once the guard clears, and skip locking.
      if (this.inactivityGuard?.()) {
        this.lastActivity = Date.now()
        return
      }
      const idle = Date.now() - this.lastActivity
      if (idle >= this.inactivityMs) {
        // lock() tears the session down in its finally even if the snapshot
        // persist throws, so fire the callback regardless — the UI must reflect
        // the now-locked state. .catch keeps a persist failure from surfacing as
        // an unhandled rejection on this fire-and-forget call.
        void this.lock()
          .catch(() => undefined)
          .finally(() => this.onLockCallback?.())
      }
    }, 30_000)
    if (typeof this.inactivityTimer.unref === 'function') this.inactivityTimer.unref()
  }

  private stopInactivityTimer(): void {
    if (this.inactivityTimer) {
      clearInterval(this.inactivityTimer)
      this.inactivityTimer = null
    }
  }

  private cooldownRemainingMs(): number {
    const now = Date.now()
    this.failures = this.failures.filter((t) => now - t < FAIL_LOCKOUT_MS)
    if (this.failures.length < MAX_FAIL_ATTEMPTS) return 0
    const oldest = this.failures[0]
    if (oldest === undefined) return 0
    return FAIL_LOCKOUT_MS - (now - oldest)
  }

  private recordFailure(): void {
    this.failures.push(Date.now())
  }
}

// ---------------------------------------------------------------------------
// crypto helpers
// ---------------------------------------------------------------------------

async function deriveKEK(secret: string, salt: Buffer): Promise<Buffer> {
  // argon2id raw output IS the KEK. wrong-secret detection comes from the
  // AES-GCM auth-tag failing during unwrap , no separate verifier needed.
  // intoSecure moves it off argon2's unpinned heap Buffer ( wiping that one )
  // into mlock'd memory for the short window the KEK is alive.
  return intoSecure(await argon2.hash(secret, { ...ARGON_OPTS, salt }))
}

function wrapKey(kek: Buffer, dek: Buffer): WrappedKey {
  const nonce = randomBytes(AES_NONCE_BYTES)
  const cipher = createCipheriv(AES_ALGO, kek, nonce)
  const ct = Buffer.concat([cipher.update(dek), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    nonce: nonce.toString('base64'),
    ciphertext: Buffer.concat([ct, tag]).toString('base64'),
  }
}

function unwrapKey(kek: Buffer, wrapped: WrappedKey): Buffer | null {
  try {
    const nonce = Buffer.from(wrapped.nonce, 'base64')
    const blob = Buffer.from(wrapped.ciphertext, 'base64')
    if (blob.length < AES_TAG_BYTES + 1) return null
    const ct = blob.subarray(0, blob.length - AES_TAG_BYTES)
    const tag = blob.subarray(blob.length - AES_TAG_BYTES)
    const decipher = createDecipheriv(AES_ALGO, kek, nonce)
    decipher.setAuthTag(tag)
    // The unwrapped DEK lives for the whole session — hand it back in mlock'd
    // memory and wipe the transient concat Buffer it briefly passed through.
    return intoSecure(Buffer.concat([decipher.update(ct), decipher.final()]))
  } catch {
    return null
  }
}

function decryptBody(body: EncryptedBody, dek: Buffer): Blob | null {
  try {
    const decipher = createDecipheriv(AES_ALGO, dek, body.nonce)
    decipher.setAuthTag(body.tag)
    // Feed each ciphertext chunk through update , no need to Buffer.concat
    // them first. Most read paths give us a single-chunk array (whole file
    // read in one go); write paths have 2 chunks (update + final).
    const decoded: Buffer[] = []
    for (const chunk of body.ciphertextChunks) decoded.push(decipher.update(chunk))
    decoded.push(decipher.final())
    const plaintext = Buffer.concat(decoded)
    return new Blob([new Uint8Array(plaintext)])
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// helpers (module-private)
// ---------------------------------------------------------------------------

function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

// AuthService delegates these to the shared module so the unit tests can hit
// them without spinning up node:crypto / argon2 / pglite.
function validatePassword(pw: string): void {
  validatePasswordShared(pw)
}

export type { AuthHeader, RecoveryEntry, WrappedKey }
