import { describe, it, expect } from 'vitest'
import { verdictForProbe, isFatalHost } from '../../../scripts/verify-manifests.mjs'

describe('verdictForProbe', () => {
  it('passes when status ok and size matches', () => {
    expect(verdictForProbe({ status: 200, totalSize: 100, expectedSize: 100 })).toEqual({
      ok: true,
      reason: 'ok',
    })
  })

  it('fails a 404 ( the embedder-missing case )', () => {
    const v = verdictForProbe({ status: 404, totalSize: null, expectedSize: 639150592 })
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/404/)
  })

  it('fails on a size mismatch ( the drift case )', () => {
    const v = verdictForProbe({ status: 200, totalSize: 209318485, expectedSize: 165555635 })
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/size/)
  })

  it('treats an unreachable host ( null status ) as failure', () => {
    expect(verdictForProbe({ status: null, totalSize: null, expectedSize: 10 }).ok).toBe(false)
  })

  it('skips the size check when the manifest size is 0 / unknown', () => {
    expect(verdictForProbe({ status: 200, totalSize: 999, expectedSize: 0 }).ok).toBe(true)
    expect(verdictForProbe({ status: 200, totalSize: null, expectedSize: 100 }).ok).toBe(true)
  })

  it('fails any other 4xx/5xx', () => {
    expect(verdictForProbe({ status: 503, totalSize: null, expectedSize: 0 }).ok).toBe(false)
  })
})

describe('isFatalHost', () => {
  it('is fatal for our own S3 host ( we control + just uploaded those )', () => {
    expect(isFatalHost('https://s3.ltwodl.com/loklm-installers/models/x.gguf')).toBe(true)
  })

  it('is warn-only for upstream hosts we do not control', () => {
    expect(isFatalHost('https://huggingface.co/buckets/LokLM/x.gguf?download=true')).toBe(false)
    expect(isFatalHost('https://github.com/k2-fsa/sherpa-onnx/releases/download/x.onnx')).toBe(false)
  })

  it('honours an overridden s3 host', () => {
    expect(isFatalHost('https://cdn.example.test/x', 'cdn.example.test')).toBe(true)
    expect(isFatalHost('https://s3.ltwodl.com/x', 'cdn.example.test')).toBe(false)
  })

  it('does not throw on a malformed url', () => {
    expect(isFatalHost('(none)')).toBe(false)
  })
})
