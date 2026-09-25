import { describe, expect, it } from 'vitest'
import { resolveInferenceThreads } from '@main/services/workers/modelMemory'

describe('hardware-aware inference thread limit', () => {
  it('uses bounded capacity before native math-core metadata is available', () => {
    expect(resolveInferenceThreads(12)).toEqual({
      maxThreads: 11,
      overrideThreads: null,
      invalidOverride: false,
    })
    expect(resolveInferenceThreads(8, '  ').maxThreads).toBe(7)
    expect(resolveInferenceThreads(1).maxThreads).toBe(1)
    expect(resolveInferenceThreads(0).maxThreads).toBe(1)
  })

  it('prefers actual math cores without assuming all CPUs have two threads per core', () => {
    expect(resolveInferenceThreads(12, undefined, 6).maxThreads).toBe(6)
    expect(resolveInferenceThreads(8, undefined, 4).maxThreads).toBe(4)
    expect(resolveInferenceThreads(4, undefined, 4).maxThreads).toBe(3)
    expect(resolveInferenceThreads(6, undefined, 8).maxThreads).toBe(5)
    expect(resolveInferenceThreads(1, undefined, 1).maxThreads).toBe(1)
  })

  it('retains explicit SMT calibration overrides and hardware defaults after invalid overrides', () => {
    expect(resolveInferenceThreads(12, '11', 6)).toEqual({
      maxThreads: 11,
      overrideThreads: 11,
      invalidOverride: false,
    })
    expect(resolveInferenceThreads(12, '12', 6)).toEqual({
      maxThreads: 6,
      overrideThreads: null,
      invalidOverride: true,
    })
  })

  it.each([0, -1, 1.5, NaN, Infinity])('handles invalid native math-core metadata %s', (math) => {
    expect(resolveInferenceThreads(12, undefined, math).maxThreads).toBe(11)
    expect(resolveInferenceThreads(1, undefined, math).maxThreads).toBe(1)
  })

  it.each(['1', '6', '11', ' 6 '])('accepts bounded integer override %s', (raw) => {
    expect(resolveInferenceThreads(12, raw)).toEqual({
      maxThreads: Number(raw),
      overrideThreads: Number(raw),
      invalidOverride: false,
    })
  })

  it.each([
    '0',
    '-1',
    '12',
    '9007199254740992',
    '1.5',
    '6.0',
    '+6',
    '6e0',
    'NaN',
    'Infinity',
    'six',
  ])('rejects invalid override %s without changing the default', (raw) => {
    expect(resolveInferenceThreads(12, raw)).toEqual({
      maxThreads: 11,
      overrideThreads: null,
      invalidOverride: true,
    })
  })

  it('checks the actual host limit, retaining at least one thread', () => {
    expect(resolveInferenceThreads(4, '6')).toEqual({
      maxThreads: 3,
      overrideThreads: null,
      invalidOverride: true,
    })
    expect(resolveInferenceThreads(1, '1')).toEqual({
      maxThreads: 1,
      overrideThreads: 1,
      invalidOverride: false,
    })
  })
})
