import { describe, it, expect } from 'vitest'
import { downmixToMono, resampleLinear, floatToBytes } from '@renderer/audio/resample'

describe('audio resample', () => {
  it('averages channels to mono', () => {
    const l = new Float32Array([0, 1, -1])
    const r = new Float32Array([0, -1, 1])
    expect(Array.from(downmixToMono([l, r]))).toEqual([0, 0, 0])
  })
  it('returns the single channel unchanged for mono input', () => {
    const m = new Float32Array([0.5, -0.5])
    expect(Array.from(downmixToMono([m]))).toEqual([0.5, -0.5])
  })
  it('resamples 4 samples at 32k down to 2 samples at 16k', () => {
    const out = resampleLinear(new Float32Array([0, 1, 2, 3]), 32000, 16000)
    expect(out.length).toBe(2)
    expect(out[0]).toBeCloseTo(0)
    expect(out[1]).toBeCloseTo(2)
  })
  it('returns input unchanged when rates match', () => {
    const i = new Float32Array([1, 2, 3])
    expect(resampleLinear(i, 16000, 16000)).toBe(i)
  })
  it('packs floats as little-endian bytes (4 per sample)', () => {
    const bytes = floatToBytes(new Float32Array([1]))
    expect(bytes.byteLength).toBe(4)
    expect(new Float32Array(bytes.buffer)[0]).toBe(1)
  })
})
