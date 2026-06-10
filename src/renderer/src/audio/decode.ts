import { downmixToMono, resampleLinear, floatToBytes, TARGET_SAMPLE_RATE } from './resample'

export interface DecodedAudio {
  /** little-endian Float32, 16 kHz mono */
  pcm: Uint8Array
  durationSec: number
}

/** Decode any browser-supported audio (mp3/m4a/wav/ogg/flac/webm-opus) to
 *  16 kHz mono Float32 PCM bytes, fully in the renderer (no ffmpeg). */
export async function decodeToMono16k(bytes: ArrayBuffer): Promise<DecodedAudio> {
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new Ctor()
  try {
    const buffer = await ctx.decodeAudioData(bytes.slice(0))
    const channels: Float32Array[] = []
    for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c))
    const mono = downmixToMono(channels)
    const resampled = resampleLinear(mono, buffer.sampleRate, TARGET_SAMPLE_RATE)
    return { pcm: floatToBytes(resampled), durationSec: resampled.length / TARGET_SAMPLE_RATE }
  } finally {
    void ctx.close()
  }
}
