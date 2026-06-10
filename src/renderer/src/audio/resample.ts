export function downmixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]!
  const len = channels[0]!.length
  const out = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    let sum = 0
    for (const ch of channels) sum += ch[i] ?? 0
    out[i] = sum / channels.length
  }
  return out
}

/** Linear-interpolation resample. Adequate for whisper (robust to mild
 *  artifacts); swap for an OfflineAudioContext render if quality demands it. */
export function resampleLinear(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (inRate === outRate) return input
  const ratio = inRate / outRate
  const outLen = Math.floor(input.length / ratio)
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const frac = pos - i0
    out[i] = (input[i0] ?? 0) * (1 - frac) + (input[i1] ?? 0) * frac
  }
  return out
}

export function floatToBytes(samples: Float32Array): Uint8Array {
  return new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
}

export const TARGET_SAMPLE_RATE = 16000
