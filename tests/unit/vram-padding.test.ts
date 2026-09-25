import { describe, expect, it } from 'vitest'
import { resolveVramPadding } from '@main/services/workers/modelMemory'

const GiB = 1024 ** 3
const MiB = 1024 ** 2

describe('calibration VRAM padding', () => {
  it('retains the default one-GiB floor, ten-percent middle and 1.2-GiB cap', () => {
    expect(resolveVramPadding(4 * GiB)).toEqual({
      paddingBytes: GiB,
      overrideMiB: null,
      invalidOverride: false,
    })
    expect(resolveVramPadding(11 * GiB).paddingBytes).toBe(11 * GiB * 0.1)
    expect(resolveVramPadding(24 * GiB).paddingBytes).toBe(1.2 * GiB)
  })

  it.each(['512', '768', '1024', '1229', ' 768 '])('accepts bounded integer override %s', (raw) => {
    expect(resolveVramPadding(4 * GiB, raw)).toEqual({
      paddingBytes: Number(raw) * MiB,
      overrideMiB: Number(raw),
      invalidOverride: false,
    })
  })

  it.each(['0', '-512', '511', '1230', 'Infinity', 'NaN', '768.5', '0x300', '1e3', '768MiB'])(
    'rejects unsafe or ambiguous override %s',
    (raw) => {
      expect(resolveVramPadding(4 * GiB, raw)).toEqual({
        paddingBytes: GiB,
        overrideMiB: null,
        invalidOverride: true,
      })
    },
  )

  it.each(['', '   ', undefined])(
    'treats absent/empty overrides as the unchanged default',
    (raw) => {
      expect(resolveVramPadding(4 * GiB, raw)).toEqual({
        paddingBytes: GiB,
        overrideMiB: null,
        invalidOverride: false,
      })
    },
  )
})
