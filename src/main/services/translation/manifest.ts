/**
 * MADLAD-400-3B-MT converted to CTranslate2 int8 — the four files the
 * loklm-translator sidecar needs at runtime. Downloaded on demand by
 * TranslationService , deliberately NOT part of MODEL_MANIFEST: translation
 * is optional and must not gate the first-launch flow.
 *
 * Sizes + SHA256 pinned from the huggingface API on 2026-06-12 (LFS oids for
 * model.bin + sentencepiece.model , locally hashed for the two git-stored
 * small files). TODO: mirror the four files into the LokLM HF org like the
 * tier bundles and repoint BASE — a third-party personal repo is not a
 * distribution channel we control.
 */

import type { DownloadableFile } from '../models/ModelDownloader'

/** Subdirectory under the models download dir holding the CT2 model. */
export const TRANSLATOR_MODEL_DIRNAME = 'translator/madlad400-3b-mt-ct2-int8'

const BASE = 'https://huggingface.co/santhosh/madlad400-3b-ct2/resolve/main'

export const TRANSLATOR_FILES: DownloadableFile[] = [
  {
    id: 'translator-model',
    filename: `${TRANSLATOR_MODEL_DIRNAME}/model.bin`,
    url: `${BASE}/model.bin`,
    sizeBytes: 2_950_208_251,
    sha256: 'f3c87256a2c888100c179d7dcd7f41df17c767469546c59d32c7dde86c740a6b',
  },
  {
    id: 'translator-spm',
    filename: `${TRANSLATOR_MODEL_DIRNAME}/sentencepiece.model`,
    url: `${BASE}/sentencepiece.model`,
    sizeBytes: 4_427_844,
    sha256: 'ef11ac9a22c7503492f56d48dce53be20e339b63605983e9f27d2cd0e0f3922c',
  },
  {
    id: 'translator-vocab',
    filename: `${TRANSLATOR_MODEL_DIRNAME}/shared_vocabulary.json`,
    url: `${BASE}/shared_vocabulary.json`,
    sizeBytes: 5_477_099,
    sha256: 'c327551ce3ca6efc7b437e11a267f79979893332dda8a1d146e2c950815193f8',
  },
  {
    id: 'translator-config',
    filename: `${TRANSLATOR_MODEL_DIRNAME}/config.json`,
    url: `${BASE}/config.json`,
    sizeBytes: 190,
    sha256: 'a428c51cd35517554523b3c6b6974a5928bc35e82b130869a543566a34a83b93',
  },
]

export const TRANSLATOR_TOTAL_BYTES = TRANSLATOR_FILES.reduce((n, f) => n + f.sizeBytes, 0)
