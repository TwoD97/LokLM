import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto'
import argon2 from 'argon2'
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
import type { AuthStatus, LoginResult, ResetResult } from '../../../shared/authTypes'

// Single-file vault layout (v4):
//
//   MAGIC          8 bytes   "LOKLM04\0"
//   HEADER_LEN     4 bytes   big-endian uint32
//   HEADER_JSON    N bytes   UTF-8 JSON — AuthHeader (wrapped DEKs, salts, displayName)
//   BODY_NONCE    12 bytes   AES-GCM nonce for the snapshot ciphertext
//   BODY_TAG      16 bytes   AES-GCM auth tag
//   BODY_CIPHER   rest       AES-256-GCM(DEK) of the pglite tar dump
//
// Why one file?
//   * The wrapped DEK and its ciphertext live or die together. Two files mean a
//     deleted/quarantined header makes the snapshot unrecoverable even with the
//     correct password or recovery phrase. One file collapses that failure
//     mode: either the vault is intact and unlockable, or it's gone.
//   * Atomic rename of one path keeps header and body in sync by construction.
//   * Backups are one file to copy.
//
// Crypto layering (unchanged from v3):
//   * DEK (32 random bytes) encrypts the snapshot body.
//   * The DEK is wrapped twice (AES-256-GCM) under independent KEKs derived
//     from (a) the password and (b) an 18-word BIP-39-style passphrase.
//   * Each KEK = argon2id(secret, salt, 32-byte raw output).
//   * DEK is constant for the install. Password reset re-wraps it under fresh
//     KEKs and re-encrypts the snapshot body under the same DEK with a new
//     nonce — original library content survives the recovery flow.
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
  ciphertext: Buffer
}

export type { AuthStatus, LoginResult, ResetResult }

const ARGON_OPTS = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB — Pflichtenheft 3.1.1
  timeCost: 3,
  parallelism: 4,
  hashLength: 32,
  raw: true as const,
}

const AES_ALGO = 'aes-256-gcm' as const
const AES_NONCE_BYTES = 12
const AES_TAG_BYTES = 16
const VAULT_MAGIC = Buffer.from('LOKLM04\0') // 8 bytes — bump when on-disk layout changes
const HEADER_LEN_BYTES = 4
const HEADER_OFFSET = VAULT_MAGIC.length + HEADER_LEN_BYTES

const DEK_BYTES = 32
const KEK_SALT_BYTES = 32

// Pflichtenheft 3.1.2: 5 fails → 5 min lockout, in-memory only.
const MAX_FAIL_ATTEMPTS = 5
const FAIL_LOCKOUT_MS = 5 * 60 * 1000

// Pflichtenheft 3.1.4: 15 min default inactivity lock.
const DEFAULT_INACTIVITY_MS = 15 * 60 * 1000

/**
 * AuthService owns the boot-time auth state, the encrypted vault lifecycle,
 * and the in-memory DEK. The Database instance only exists between
 * login()/register() and lock()/logout().
 *
 * Files under userData/:
 *   loklm.vault   — one file: header (wrapped DEKs + metadata) + AES-GCM(DEK)(pglite tar dump)
 */
export class AuthService {
  private readonly vaultFilePath: string
  private cache: AuthHeader | null = null
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
    this.vaultFilePath = join(userDataDir, 'loklm.vault')
  }

  // -------------------------------------------------------------------------
  // Public surface
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
    await this.seedAuthTables(this.database, header)
    const body = await this.encryptCurrentDb(dek)
    await this.writeVault(header, body)
    this.cache = header
    this.cacheLoaded = true
    this.startInactivityTimer()
    return { passphrase }
  }

  async login(password: string): Promise<LoginResult> {
    const vault = await this.readVault()
    if (!vault) return { ok: false, reason: 'no_user' }

    const cooldown = this.cooldownRemainingMs()
    if (cooldown > 0) return { ok: false, reason: 'rate_limited', retryAfterMs: cooldown }

    const passwordSalt = Buffer.from(vault.header.passwordSalt, 'base64')
    const passwordKek = await deriveKEK(password, Buffer.from(passwordSalt))
    const dek = unwrapKey(passwordKek, vault.header.passwordWrappedDek)
    passwordKek.fill(0)

    if (!dek) {
      this.recordFailure()
      return { ok: false, reason: 'bad_password' }
    }

    // DEK is in hand. Decrypt the body. With single-file vaults, header and
    // body live together so any failure here means physical file corruption,
    // not an auth/snapshot drift.
    const snapshotBlob = decryptBody(vault.body, dek)
    if (snapshotBlob == null) {
      dek.fill(0)
      throw new Error(
        'Vault body failed to decrypt — file is corrupt. Restore from backup if available.',
      )
    }

    this.dek = dek
    this.database = await Database.create(undefined, snapshotBlob)
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
    const vault = await this.readVault()
    if (!vault) return { ok: false, reason: 'no_user' }
    const cooldown = this.cooldownRemainingMs()
    if (cooldown > 0) return { ok: false, reason: 'rate_limited', retryAfterMs: cooldown }

    validatePassword(input.newPassword)

    // Early reject: bad shape / unknown words → no argon2, no rate-limit hit.
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

    const newHeader: AuthHeader = {
      ...vault.header,
      passwordSalt: newPasswordSalt.toString('base64'),
      passwordWrappedDek: newPasswordWrappedDek,
      recoveryEntries: [newEntry],
    }
    const usedEntry = vault.header.recoveryEntries[matchedIdx]
    if (usedEntry) usedEntry.usedAt = nowSec()

    const snapshotBlob = decryptBody(vault.body, dek)
    this.dek = dek
    this.database = await Database.create(undefined, snapshotBlob ?? undefined)
    await this.seedAuthTables(this.database, newHeader)
    const newBody = await this.encryptCurrentDb(dek)
    await this.writeVault(newHeader, newBody)
    this.cache = newHeader
    this.cacheLoaded = true
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

  private async loadHeader(): Promise<AuthHeader | null> {
    if (this.cacheLoaded) return this.cache
    const vault = await this.readVault()
    this.cache = vault?.header ?? null
    this.cacheLoaded = true
    return this.cache
  }

  private async readVault(): Promise<{ header: AuthHeader; body: EncryptedBody } | null> {
    let raw: Buffer
    try {
      raw = await fs.readFile(this.vaultFilePath)
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null
      throw err
    }
    if (raw.length < HEADER_OFFSET) {
      throw new Error(`Vault file at ${this.vaultFilePath} is truncated (too short for header).`)
    }
    const magic = raw.subarray(0, VAULT_MAGIC.length)
    if (!timingSafeEqual(magic, VAULT_MAGIC)) {
      throw new Error(
        `Vault file at ${this.vaultFilePath} is not a LokLM v4 vault. Delete it to start over, or restore from a backup.`,
      )
    }
    const headerLen = raw.readUInt32BE(VAULT_MAGIC.length)
    const bodyOffset = HEADER_OFFSET + headerLen
    if (raw.length < bodyOffset + AES_NONCE_BYTES + AES_TAG_BYTES) {
      throw new Error(`Vault file at ${this.vaultFilePath} is truncated (header.len=${headerLen}).`)
    }
    const headerJson = raw.subarray(HEADER_OFFSET, bodyOffset).toString('utf8')
    let header: AuthHeader
    try {
      header = JSON.parse(headerJson) as AuthHeader
    } catch {
      throw new Error(`Vault header is not valid JSON in ${this.vaultFilePath}.`)
    }
    if (header.version !== 4) {
      throw new Error(
        `Vault header version ${header.version} is not supported by this build. Delete ${this.vaultFilePath} to start over.`,
      )
    }
    const nonce = raw.subarray(bodyOffset, bodyOffset + AES_NONCE_BYTES)
    const tag = raw.subarray(
      bodyOffset + AES_NONCE_BYTES,
      bodyOffset + AES_NONCE_BYTES + AES_TAG_BYTES,
    )
    const ciphertext = raw.subarray(bodyOffset + AES_NONCE_BYTES + AES_TAG_BYTES)
    return { header, body: { nonce, tag, ciphertext } }
  }

  private async writeVault(header: AuthHeader, body: EncryptedBody): Promise<void> {
    const headerJson = Buffer.from(JSON.stringify(header), 'utf8')
    const headerLen = Buffer.alloc(HEADER_LEN_BYTES)
    headerLen.writeUInt32BE(headerJson.length, 0)
    const out = Buffer.concat([
      VAULT_MAGIC,
      headerLen,
      headerJson,
      body.nonce,
      body.tag,
      body.ciphertext,
    ])
    await fs.mkdir(dirname(this.vaultFilePath), { recursive: true })
    const tmp = this.vaultFilePath + '.tmp'
    await fs.writeFile(tmp, out, { mode: 0o600 })
    await fs.rename(tmp, this.vaultFilePath)
  }

  private async persistSnapshot(): Promise<void> {
    if (!this.database || !this.dek || !this.cache) {
      throw new Error('persistSnapshot called without a live session')
    }
    const body = await this.encryptCurrentDb(this.dek)
    await this.writeVault(this.cache, body)
  }

  private async encryptCurrentDb(dek: Buffer): Promise<EncryptedBody> {
    if (!this.database) throw new Error('encryptCurrentDb called without a live database')
    const blob = await this.database.dump()
    const plaintext = Buffer.from(await blob.arrayBuffer())
    const nonce = randomBytes(AES_NONCE_BYTES)
    const cipher = createCipheriv(AES_ALGO, dek, nonce)
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const tag = cipher.getAuthTag()
    return { nonce, tag, ciphertext }
  }

  private async seedAuthTables(db: Database, header: AuthHeader): Promise<void> {
    // Pflichtenheft 4.2 expects users + recovery_codes rows in the DB. The
    // bootstrap source-of-truth still lives in the vault header — these rows
    // are schema-compliance copies, kept in sync at register/reset. The SQL
    // password_hash column gets an opaque marker; verification always goes
    // through the wrapped-DEK unwrap, never through the SQL row.
    await db.replaceAuthRows({
      displayName: header.displayName,
      passwordHash: '$wrapped-dek$', // placeholder — never compared against
      recoveryHashes: header.recoveryEntries.map((r) => ({
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
    if (oldest === undefined) return 0
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
  return argon2.hash(secret, { ...ARGON_OPTS, salt })
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

function decryptBody(body: EncryptedBody, dek: Buffer): Blob | null {
  try {
    const decipher = createDecipheriv(AES_ALGO, dek, body.nonce)
    decipher.setAuthTag(body.tag)
    const plaintext = Buffer.concat([decipher.update(body.ciphertext), decipher.final()])
    return new Blob([new Uint8Array(plaintext)])
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

export type { AuthHeader, RecoveryEntry, WrappedKey }
