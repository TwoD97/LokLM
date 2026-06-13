import { describe, it, expect } from 'vitest'
import { createCipheriv, randomBytes } from 'node:crypto'
import {
  deriveKEK,
  wrapKey,
  unwrapKey,
  decryptBody,
  isLockedError,
  LockedError,
} from '@main/services/auth/AuthService'

// AP-T.1 (Pflichtenheft §8.1) — Unit-Tests der Auth-Hashing-Wrapper.
//
// Abweichung vom Ticket-Text: das Ticket nennt einen "PBKDF2-Wrapper". Den gibt
// es bewusst NICHT — ADR-0001 hat PBKDF2 (speicherarm, GPU-/ASIC-billig)
// zugunsten von memory-hard Argon2id explizit verworfen (Bitwarden-Profil
// m=64 MiB, t=3, p=4). Getestet werden daher die tatsächlich implementierten
// Wrapper: deriveKEK (Argon2id) und wrapKey/unwrapKey/decryptBody (AES-256-GCM).
// Siehe docs/adr/0001-argon2id-password-kdf.md und docs/adr/0002-envelope-encryption-aes-gcm.md.

const AES_ALGO = 'aes-256-gcm' as const

describe('deriveKEK (Argon2id wrapper)', () => {
  // one salt reused across the determinism checks so we compare derivations,
  // not salts.
  const salt = randomBytes(32)

  it('derives a 32-byte raw KEK (= an AES-256 key)', async () => {
    const kek = await deriveKEK('correct horse battery staple', salt)
    expect(kek).toHaveLength(32)
  })

  it('is deterministic for the same secret + salt', async () => {
    const a = await deriveKEK('passwort-123', salt)
    const b = await deriveKEK('passwort-123', salt)
    expect(a.equals(b)).toBe(true)
  })

  it('produces a different KEK for a different salt (per-secret salting)', async () => {
    const a = await deriveKEK('passwort-123', salt)
    const b = await deriveKEK('passwort-123', randomBytes(32))
    expect(a.equals(b)).toBe(false)
  })
})

describe('wrapKey / unwrapKey (AES-256-GCM key wrapping)', () => {
  it('round-trips: unwrap recovers exactly the wrapped DEK', () => {
    const kek = randomBytes(32)
    const dek = randomBytes(32)
    const wrapped = wrapKey(kek, dek)
    const out = unwrapKey(kek, wrapped)
    expect(out).not.toBeNull()
    expect(out!.equals(dek)).toBe(true)
  })

  it('emits base64 nonce (12 B) and ciphertext (32 B DEK + 16 B tag)', () => {
    const wrapped = wrapKey(randomBytes(32), randomBytes(32))
    expect(Buffer.from(wrapped.nonce, 'base64')).toHaveLength(12)
    expect(Buffer.from(wrapped.ciphertext, 'base64')).toHaveLength(32 + 16)
  })

  it('returns null for the wrong KEK (GCM tag mismatch)', () => {
    const dek = randomBytes(32)
    const wrapped = wrapKey(randomBytes(32), dek)
    expect(unwrapKey(randomBytes(32), wrapped)).toBeNull()
  })

  it('returns null when the ciphertext is tampered', () => {
    const kek = randomBytes(32)
    const wrapped = wrapKey(kek, randomBytes(32))
    const blob = Buffer.from(wrapped.ciphertext, 'base64')
    blob[0] ^= 0xff // flip a byte
    const tampered = { nonce: wrapped.nonce, ciphertext: blob.toString('base64') }
    expect(unwrapKey(kek, tampered)).toBeNull()
  })

  it('returns null for a too-short ciphertext blob (length guard)', () => {
    const wrapped = { nonce: randomBytes(12).toString('base64'), ciphertext: 'AAAA' }
    expect(unwrapKey(randomBytes(32), wrapped)).toBeNull()
  })
})

describe('decryptBody (AES-256-GCM snapshot body)', () => {
  // helper: encrypt plaintext under `dek`, return the EncryptedBody shape
  // decryptBody consumes (single ciphertext chunk).
  const seal = (dek: Buffer, plaintext: Buffer) => {
    const nonce = randomBytes(12)
    const cipher = createCipheriv(AES_ALGO, dek, nonce)
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()])
    return { nonce, tag: cipher.getAuthTag(), ciphertextChunks: [ct] }
  }

  it('round-trips the plaintext through a Blob', async () => {
    const dek = randomBytes(32)
    const plaintext = Buffer.from('pglite snapshot bytes', 'utf8')
    const blob = decryptBody(seal(dek, plaintext), dek)
    expect(blob).not.toBeNull()
    const out = Buffer.from(await blob!.arrayBuffer())
    expect(out.equals(plaintext)).toBe(true)
  })

  it('decrypts a body split across multiple ciphertext chunks', async () => {
    const dek = randomBytes(32)
    const plaintext = randomBytes(40)
    const nonce = randomBytes(12)
    const cipher = createCipheriv(AES_ALGO, dek, nonce)
    // two update() chunks + final() — mirrors the write path's chunk array.
    const chunks = [
      cipher.update(plaintext.subarray(0, 20)),
      cipher.update(plaintext.subarray(20)),
      cipher.final(),
    ]
    const blob = decryptBody({ nonce, tag: cipher.getAuthTag(), ciphertextChunks: chunks }, dek)
    expect(blob).not.toBeNull()
    expect(Buffer.from(await blob!.arrayBuffer()).equals(plaintext)).toBe(true)
  })

  it('returns null for the wrong DEK', () => {
    const body = seal(randomBytes(32), Buffer.from('x'))
    expect(decryptBody(body, randomBytes(32))).toBeNull()
  })

  it('returns null when the auth tag is tampered', () => {
    const dek = randomBytes(32)
    const body = seal(dek, Buffer.from('x'))
    body.tag[0] ^= 0xff
    expect(decryptBody(body, dek)).toBeNull()
  })
})

describe('isLockedError', () => {
  it('detects a LockedError instance', () => {
    expect(isLockedError(new LockedError())).toBe(true)
  })

  it('detects the serialized shape across the IPC boundary (code / name)', () => {
    expect(isLockedError({ code: 'LOCKED' })).toBe(true)
    expect(isLockedError({ name: 'LockedError' })).toBe(true)
  })

  it('is false for unrelated errors and non-objects', () => {
    expect(isLockedError(new Error('nope'))).toBe(false)
    expect(isLockedError(null)).toBe(false)
    expect(isLockedError(undefined)).toBe(false)
    expect(isLockedError('locked')).toBe(false)
  })
})
