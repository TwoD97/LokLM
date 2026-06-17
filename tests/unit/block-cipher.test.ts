import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import {
  encryptBlock,
  decryptBlock,
  BLOCK_OVERHEAD_BYTES,
} from '../../src/main/services/storage/blockCipher'

const key = (): Buffer => randomBytes(32)

describe('blockCipher', () => {
  it('round-trips a block', () => {
    const k = key()
    const pt = Buffer.from('hello vectors '.repeat(100))
    const stored = encryptBlock(k, 'data.lance', 0, pt)
    expect(stored.length).toBe(BLOCK_OVERHEAD_BYTES + pt.length)
    expect(decryptBlock(k, 'data.lance', 0, stored).equals(pt)).toBe(true)
  })

  it('produces a fresh nonce per write (no deterministic ciphertext)', () => {
    const k = key()
    const pt = Buffer.from('same plaintext')
    const a = encryptBlock(k, 'f', 0, pt)
    const b = encryptBlock(k, 'f', 0, pt)
    expect(a.equals(b)).toBe(false)
  })

  it('rejects the wrong key', () => {
    const stored = encryptBlock(key(), 'f', 0, Buffer.from('x'))
    expect(() => decryptBlock(key(), 'f', 0, stored)).toThrow()
  })

  it('rejects a block read at the wrong index (AAD binds position)', () => {
    const k = key()
    const stored = encryptBlock(k, 'f', 3, Buffer.from('payload'))
    expect(() => decryptBlock(k, 'f', 4, stored)).toThrow()
  })

  it('rejects a block relocated to another file (AAD binds fileId)', () => {
    const k = key()
    const stored = encryptBlock(k, 'a.lance', 0, Buffer.from('payload'))
    expect(() => decryptBlock(k, 'b.lance', 0, stored)).toThrow()
  })

  it('detects ciphertext tampering', () => {
    const k = key()
    const stored = encryptBlock(k, 'f', 0, Buffer.from('payload'))
    const last = stored.length - 1
    stored.writeUInt8(stored.readUInt8(last) ^ 0x01, last)
    expect(() => decryptBlock(k, 'f', 0, stored)).toThrow()
  })

  it('rejects a non-32-byte key', () => {
    expect(() => encryptBlock(randomBytes(16), 'f', 0, Buffer.alloc(1))).toThrow()
  })
})
