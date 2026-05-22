import { describe, it, expect } from 'vitest'
import { isLoopbackBaseUrl } from './networkHelpers'

describe('isLoopbackBaseUrl', () => {
  it.each([
    'http://localhost:11434',
    'http://localhost',
    'https://localhost:8080',
    'http://127.0.0.1:11434',
    'http://127.1.2.3:11434',
    'http://[::1]:11434',
  ])('accepts loopback host %s', (url) => {
    expect(isLoopbackBaseUrl(url)).toBe(true)
  })

  it.each([
    'http://192.168.1.42:11434',
    'http://10.0.0.5:11434',
    'http://ollama.example.com',
    'https://api.openai.com',
    'http://127.0.0.1.evil.com',
    'http://0.0.0.0:11434',
    'http://169.254.169.254',
  ])('rejects non-loopback host %s', (url) => {
    expect(isLoopbackBaseUrl(url)).toBe(false)
  })

  it('treats malformed URLs as non-loopback', () => {
    expect(isLoopbackBaseUrl('not a url')).toBe(false)
    expect(isLoopbackBaseUrl('')).toBe(false)
  })
})
