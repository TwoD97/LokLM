import { describe, it, expect } from 'vitest'
import { applyPrefix } from '../evals/bridges/EmbedderBridge'

describe('applyPrefix', () => {
  it('prepends a non-empty prefix', () => {
    expect(applyPrefix('query: ', 'was ist DHCP')).toBe('query: was ist DHCP')
  })
  it('returns text unchanged when prefix is undefined or empty', () => {
    expect(applyPrefix(undefined, 'hallo')).toBe('hallo')
    expect(applyPrefix('', 'hallo')).toBe('hallo')
  })
})
