import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import {
  createWorkspaceKey,
  wrapWorkspaceKey,
  unwrapWorkspaceKey,
  WDEK_BYTES,
} from '../../src/main/services/auth/workspaceKeys'

const master = (): Buffer => randomBytes(32)

describe('workspaceKeys', () => {
  it('creates a wrapped WDEK that unwraps back to itself', () => {
    const m = master()
    const { wdek, wrapped } = createWorkspaceKey(m)
    expect(wdek.length).toBe(WDEK_BYTES)
    const back = unwrapWorkspaceKey(m, wrapped)
    expect(back).not.toBeNull()
    expect(back!.equals(wdek)).toBe(true)
  })

  it('returns null for the wrong master DEK (no throw, mirrors unwrapKey)', () => {
    const { wrapped } = createWorkspaceKey(master())
    expect(unwrapWorkspaceKey(master(), wrapped)).toBeNull()
  })

  it('returns null on a tampered wrap', () => {
    const m = master()
    const { wrapped } = createWorkspaceKey(m)
    const blob = Buffer.from(wrapped.ciphertext, 'base64')
    blob.writeUInt8(blob.readUInt8(0) ^ 0x01, 0)
    expect(unwrapWorkspaceKey(m, { ...wrapped, ciphertext: blob.toString('base64') })).toBeNull()
  })

  it('wraps an externally-supplied WDEK', () => {
    const m = master()
    const wdek = randomBytes(WDEK_BYTES)
    const back = unwrapWorkspaceKey(m, wrapWorkspaceKey(m, wdek))
    expect(back!.equals(wdek)).toBe(true)
  })

  it('uses a fresh nonce per wrap', () => {
    const m = master()
    const wdek = randomBytes(WDEK_BYTES)
    expect(wrapWorkspaceKey(m, wdek).nonce).not.toBe(wrapWorkspaceKey(m, wdek).nonce)
  })
})
