import type { WhisperModelId } from '@shared/transcription'

export interface WhisperModelEntry {
  id: WhisperModelId
  file: string
  bytes: number
  sha256: string
  url: string
  bundled: boolean
}

const BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'

// sha256 = HuggingFace LFS oid for each ggml file (verified against the locally
// fetched ggml-base.bin). Used by the model-picker downloader for integrity.
export const WHISPER_MODELS: Record<WhisperModelId, WhisperModelEntry> = {
  tiny: {
    id: 'tiny',
    file: 'ggml-tiny.bin',
    bytes: 77_691_713,
    sha256: 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21',
    url: `${BASE_URL}/ggml-tiny.bin`,
    bundled: false,
  },
  base: {
    id: 'base',
    file: 'ggml-base.bin',
    bytes: 147_951_465,
    sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
    url: `${BASE_URL}/ggml-base.bin`,
    bundled: true,
  },
  small: {
    id: 'small',
    file: 'ggml-small.bin',
    bytes: 487_601_967,
    sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b',
    url: `${BASE_URL}/ggml-small.bin`,
    bundled: false,
  },
  medium: {
    id: 'medium',
    file: 'ggml-medium.bin',
    bytes: 1_533_763_059,
    sha256: '6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208',
    url: `${BASE_URL}/ggml-medium.bin`,
    bundled: false,
  },
}

export function modelEntry(id: WhisperModelId): WhisperModelEntry {
  return WHISPER_MODELS[id]
}
