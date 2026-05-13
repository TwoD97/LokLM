import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto'
import { hashRaw as argonHashRaw, Algorithm } from '@node-rs/argon2'
import { Database } from '../db/database'
import {
  generatePassphrase as generatePassphraseShared,
  normalisePassphrase as normalisePassphraseShared,
  validatePassphrase as validatePassphraseShared,
  validatePassword as validatePasswordShared,
  getWordlist,
  PASSPHRASE_WORDS,
  type WordlistLang,
} from '../../shared/authHelpers'

// auth.json — bootstrap material for unlocking the encrypted snapshot.
// Lives outside the encrypted snapshot itself: salts, verifier-free wrapped
// keys, no password material.
//
// Crypto layering (v3):
//   * DEK (32 random bytes) is the key that actually encrypts the snapshot.
//   * The DEK is wrapped (AES-256-GCM) under two independent KEKs:
//       - one KEK derived from the password
//       - one KEK derived from an 18-word BIP-39-style passphrase
//   * Each KEK = argon2id(secret, salt, 32-byte raw output).
//   * The DEK never changes for the lifetime of the install. Password reset
//     re-wraps the DEK under a new password-KEK and a fresh passphrase-KEK —
//     the snapshot ciphertext is untouched, so the library survives a recovery flow.
interface AuthFile {
  version: 3
  displayName: string
  passwordSalt: string // base64(32) — KEK derivation salt for password
  passwordWrappedDek: WrappedKey // DEK encrypted under password-KEK
  recoveryEntries: RecoveryEntry[] // length 1 in v3
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

export type AuthStatus = {
  registered: boolean
  locked: boolean
  displayName: string | null
  remainingRecoveryCodes: number // 0 or 1
  recoveryLang: WordlistLang | null
}

export type LoginResult =
  | { ok: true }
  | { ok: false; reason: 'no_user' | 'bad_password' | 'rate_limited'; retryAfterMs?: number }

export type ResetResult =
  | { ok: true; passphrase: string[] }
  | { ok: false; reason: 'no_user' | 'bad_code' | 'rate_limited'; retryAfterMs?: number }

const ARGON_OPTS = {
  algorithm: Algorithm.Argon2id as const,
  memoryCost: 65536, // 64 MiB — Pflichtenheft 3.1.1
  timeCost: 3,
  parallelism: 4,
  outputLen: 32,
}

const AES_ALGO = 'aes-256-gcm' as const
const AES_NONCE_BYTES = 12
const AES_TAG_BYTES = 16
const SNAPSHOT_MAGIC = Buffer.from('LOKLM02\0') // 8 bytes — bumps with auth.json schema

const DEK_BYTES = 32
const KEK_SALT_BYTES = 32

// Pflichtenheft 3.1.2: 5 fails → 5 min lockout, in-memory only.
const MAX_FAIL_ATTEMPTS = 5
const FAIL_LOCKOUT_MS = 5 * 60 * 1000

// Pflichtenheft 3.1.4: 15 min default inactivity lock.
const DEFAULT_INACTIVITY_MS = 15 * 60 * 1000

/**
 * AuthService owns the boot-time auth state, the encrypted-snapshot lifecycle,
 * and the in-memory DEK. The Database instance only exists between
 * login()/register() and lock()/logout().
 *
 * Files under userData/:
 *   auth.json              — wrapped DEK envelopes (password + recovery codes)
 *   pgdata.snapshot.enc    — AES-256-GCM(DEK) of the pglite tar dump
 */
export class AuthService {
  private readonly authFilePath: string
  private readonly snapshotFilePath: string
  private cache: AuthFile | null = null
  private cacheLoaded = false

  // Live session state — only populated between login()/register() and lock().
  private dek: Buffer | null = null
  private database: Database | null = null
  private lastActivity = Date.now()
  private inactivityMs = DEFAULT_INACTIVITY_MS
  private inactivityTimer: NodeJS.Timeout | null = null
  private onLockCallback: (() => void) | null = null

  // Brute-force tracker for the login flow.
  private failures: number[] = []

  constructor(userDataDir: string) {
    this.authFilePath = join(userDataDir, 'auth.json')
    this.snapshotFilePath = join(userDataDir, 'pgdata.snapshot.enc')
  }

  // -------------------------------------------------------------------------
  // Public surface
  // -------------------------------------------------------------------------

  async status(): Promise<AuthStatus> {
    const a = await this.loadAuth()
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
    if (await this.loadAuth()) {
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

    const dek = randomBytes(DEK_BYTES)

    const passwordSalt = randomBytes(KEK_SALT_BYTES)
    const passwordKek = await deriveKEK(input.password, Buffer.from(passwordSalt))
    const passwordWrappedDek = wrapKey(passwordKek, dek)
    passwordKek.fill(0)

    // One recovery entry, derived from the canonicalized passphrase.
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
    recoveryKek.fill(0)

    const auth: AuthFile = {
      version: 3,
      displayName,
      passwordSalt: passwordSalt.toString('base64'),
      passwordWrappedDek,
      recoveryEntries: [recoveryEntry],
      recoveryLang: input.recoveryLang,
      createdAt: nowSec(),
    }
    await this.writeAuth(auth)
    this.cache = auth

    this.dek = dek
    this.database = await Database.create(undefined)
    await this.seedAuthTables(this.database, auth)
    await this.persistSnapshot()
    this.startInactivityTimer()
    return { passphrase }
  }

  async login(password: string): Promise<LoginResult> {
    const auth = await this.loadAuth()
    if (!auth) return { ok: false, reason: 'no_user' }

    const cooldown = this.cooldownRemainingMs()
    if (cooldown > 0) return { ok: false, reason: 'rate_limited', retryAfterMs: cooldown }

    const passwordSalt = Buffer.from(auth.passwordSalt, 'base64')
    const passwordKek = await deriveKEK(password, Buffer.from(passwordSalt))
    const dek = unwrapKey(passwordKek, auth.passwordWrappedDek)
    passwordKek.fill(0)

    if (!dek) {
      this.recordFailure()
      return { ok: false, reason: 'bad_password' }
    }

    // DEK is in hand. Decrypt the snapshot if one exists; otherwise we land
    // in a recovery-from-no-snapshot branch (e.g. process died between
    // register and first persist) and rebuild from auth.json.
    const snapshotBlob = await this.readAndDecryptSnapshot(dek)
    if (snapshotBlob === 'mismatch') {
      // DEK unwrap succeeded so the password is right — but the snapshot tag
      // disagrees. The snapshot file is corrupt / from a different DEK.
      // Don't punish the user with a "bad password" message; surface the
      // distinct failure so they can act on it.
      dek.fill(0)
      throw new Error(
        'Snapshot file is unreadable — auth.json and pgdata.snapshot.enc are out of sync.',
      )
    }

    this.dek = dek
    this.database = await Database.create(undefined, snapshotBlob ?? undefined)
    if (snapshotBlob == null) {
      // No snapshot yet — happens once if the previous register() crashed
      // between writing auth.json and the first snapshot. Re-seed and persist.
      await this.seedAuthTables(this.database, auth)
      await this.persistSnapshot()
    }
    this.failures = []
    this.startInactivityTimer()
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
    }
  }

  async logout(): Promise<void> {
    // Same effect as lock — single-user app has no notion of switching identities.
    await this.lock()
  }

  async reset(input: { passphrase: string; newPassword: string }): Promise<ResetResult> {
    const auth = await this.loadAuth()
    if (!auth) return { ok: false, reason: 'no_user' }
    const cooldown = this.cooldownRemainingMs()
    if (cooldown > 0) return { ok: false, reason: 'rate_limited', retryAfterMs: cooldown }

    validatePassword(input.newPassword)

    // Early reject: bad shape / unknown words → no argon2, no rate-limit hit.
    const wordlist = getWordlist(auth.recoveryLang)
    const words = normalisePassphraseShared(input.passphrase).split(' ')
    const check = validatePassphraseShared(words, wordlist)
    if (!check.ok) return { ok: false, reason: 'bad_code' }

    let dek: Buffer | null = null
    let matchedIdx = -1
    for (let i = 0; i < auth.recoveryEntries.length; i++) {
      const entry = auth.recoveryEntries[i]
      if (entry.usedAt != null) continue
      const salt = Buffer.from(entry.salt, 'base64')
      const kek = await deriveKEK(words.join(' '), salt)
      const candidate = unwrapKey(kek, entry.wrappedDek)
      kek.fill(0)
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

    // Re-wrap the same DEK under a new password-KEK and mint a fresh
    // passphrase (same recoveryLang as registered).
    const newPasswordSalt = randomBytes(KEK_SALT_BYTES)
    const newPasswordKek = await deriveKEK(input.newPassword, Buffer.from(newPasswordSalt))
    const newPasswordWrappedDek = wrapKey(newPasswordKek, dek)
    newPasswordKek.fill(0)

    const newPassphrase = generatePassphraseShared(wordlist, PASSPHRASE_WORDS, randomBytes)
    const newRecoverySalt = randomBytes(KEK_SALT_BYTES)
    const newRecoveryKek = await deriveKEK(newPassphrase.join(' '), Buffer.from(newRecoverySalt))
    const newEntry: RecoveryEntry = {
      salt: newRecoverySalt.toString('base64'),
      wrappedDek: wrapKey(newRecoveryKek, dek),
      createdAt: nowSec(),
      usedAt: null,
    }
    newRecoveryKek.fill(0)

    auth.passwordSalt = newPasswordSalt.toString('base64')
    auth.passwordWrappedDek = newPasswordWrappedDek
    auth.recoveryEntries[matchedIdx].usedAt = nowSec()
    auth.recoveryEntries = [newEntry]
    await this.writeAuth(auth)
    this.cache = auth

    const snapshotBlob = await this.readAndDecryptSnapshot(dek)
    const useBlob = snapshotBlob === 'mismatch' ? undefined : (snapshotBlob ?? undefined)
    this.dek = dek
    this.database = await Database.create(undefined, useBlob)
    await this.seedAuthTables(this.database, auth)
    await this.persistSnapshot()
    this.failures = []
    this.startInactivityTimer()
    return { ok: true, passphrase: newPassphrase }
  }

  // -------------------------------------------------------------------------
  // Session helpers used by the IPC layer
  // -------------------------------------------------------------------------

  /** Returns the live Database, or throws when the session is locked. */
  requireDatabase(): Database {
    if (!this.database) {
      throw new Error('locked')
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

  async persistSnapshotIfUnlocked(): Promise<void> {
    if (this.dek && this.database) {
      await this.persistSnapshot()
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private async loadAuth(): Promise<AuthFile | null> {
    if (this.cacheLoaded) return this.cache
    try {
      const raw = await fs.readFile(this.authFilePath, 'utf8')
      const parsed = JSON.parse(raw) as AuthFile
      if (parsed.version !== 3) {
        throw new Error(
          `auth.json version ${parsed.version} is not supported by this build. Delete ${this.authFilePath} to start over.`,
        )
      }
      this.cache = parsed
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
        this.cache = null
      } else {
        throw err
      }
    }
    this.cacheLoaded = true
    return this.cache
  }

  private async writeAuth(auth: AuthFile): Promise<void> {
    await fs.mkdir(dirname(this.authFilePath), { recursive: true })
    const tmp = this.authFilePath + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(auth, null, 2), { encoding: 'utf8', mode: 0o600 })
    await fs.rename(tmp, this.authFilePath)
  }

  private async persistSnapshot(): Promise<void> {
    if (!this.database || !this.dek) {
      throw new Error('persistSnapshot called without a live session')
    }
    const blob = await this.database.dump()
    const plaintext = Buffer.from(await blob.arrayBuffer())
    const nonce = randomBytes(AES_NONCE_BYTES)
    const cipher = createCipheriv(AES_ALGO, this.dek, nonce)
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const tag = cipher.getAuthTag()
    const out = Buffer.concat([SNAPSHOT_MAGIC, nonce, tag, ciphertext])

    const tmp = this.snapshotFilePath + '.tmp'
    await fs.mkdir(dirname(this.snapshotFilePath), { recursive: true })
    await fs.writeFile(tmp, out, { mode: 0o600 })
    await fs.rename(tmp, this.snapshotFilePath)
  }

  /**
   * Reads + decrypts the snapshot. Returns:
   *   Blob       — restored tar payload, ready for PGlite.loadDataDir
   *   null       — no snapshot file yet (first login after register that crashed before save)
   *   'mismatch' — snapshot exists but auth tag failed (drifted from this DEK)
   */
  private async readAndDecryptSnapshot(dek: Buffer): Promise<Blob | null | 'mismatch'> {
    let raw: Buffer
    try {
      raw = await fs.readFile(this.snapshotFilePath)
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null
      throw err
    }
    if (raw.length < SNAPSHOT_MAGIC.length + AES_NONCE_BYTES + AES_TAG_BYTES) return 'mismatch'
    const magic = raw.subarray(0, SNAPSHOT_MAGIC.length)
    if (!timingSafeEqual(magic, SNAPSHOT_MAGIC)) return 'mismatch'
    const nonce = raw.subarray(SNAPSHOT_MAGIC.length, SNAPSHOT_MAGIC.length + AES_NONCE_BYTES)
    const tag = raw.subarray(
      SNAPSHOT_MAGIC.length + AES_NONCE_BYTES,
      SNAPSHOT_MAGIC.length + AES_NONCE_BYTES + AES_TAG_BYTES,
    )
    const ciphertext = raw.subarray(SNAPSHOT_MAGIC.length + AES_NONCE_BYTES + AES_TAG_BYTES)
    try {
      const decipher = createDecipheriv(AES_ALGO, dek, nonce)
      decipher.setAuthTag(tag)
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
      return new Blob([new Uint8Array(plaintext)])
    } catch {
      return 'mismatch'
    }
  }

  private async seedAuthTables(db: Database, auth: AuthFile): Promise<void> {
    // Pflichtenheft 4.2 expects users + recovery_codes rows in the DB. The
    // bootstrap source-of-truth still lives in auth.json — these rows are
    // schema-compliance copies, kept in sync at register/reset. The SQL
    // password_hash column gets a random opaque marker; verification always
    // goes through the wrapped-DEK unwrap, never through the SQL row.
    await db.replaceAuthRows({
      displayName: auth.displayName,
      passwordHash: '$wrapped-dek$', // placeholder — never compared against
      recoveryHashes: auth.recoveryEntries.map((r) => ({
        hash: '$wrapped-dek$',
        createdAt: r.createdAt,
        usedAt: r.usedAt,
      })),
    })
  }

  private async shutdownDatabase(): Promise<void> {
    const db = this.database
    this.database = null
    if (db) {
      try {
        await db.close()
      } catch {
        /* ignore close races */
      }
    }
  }

  private zeroKey(): void {
    if (this.dek) {
      this.dek.fill(0)
      this.dek = null
    }
  }

  private startInactivityTimer(): void {
    this.stopInactivityTimer()
    this.lastActivity = Date.now()
    // Tick every 30s — granularity is fine, we just need expiry detection.
    this.inactivityTimer = setInterval(() => {
      if (!this.isUnlocked()) return
      const idle = Date.now() - this.lastActivity
      if (idle >= this.inactivityMs) {
        void this.lock().then(() => this.onLockCallback?.())
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
    return FAIL_LOCKOUT_MS - (now - oldest)
  }

  private recordFailure(): void {
    this.failures.push(Date.now())
  }
}

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

async function deriveKEK(secret: string, salt: Buffer): Promise<Buffer> {
  // argon2id raw output IS the KEK. Wrong-secret detection happens at the
  // AES-GCM auth-tag check during unwrap — no separate verifier needed.
  return argonHashRaw(secret, { ...ARGON_OPTS, salt })
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
    return Buffer.concat([decipher.update(ct), decipher.final()])
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Helpers (module-private)
// ---------------------------------------------------------------------------

function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

// AuthService delegates these to the shared module so the unit tests can
// exercise them without spinning up node:crypto / argon2 / pglite.
function validatePassword(pw: string): void {
  validatePasswordShared(pw)
}

export type { AuthFile, RecoveryEntry, WrappedKey }
