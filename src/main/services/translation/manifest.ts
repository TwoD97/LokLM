/**
 * MADLAD-400-3B-MT converted to CTranslate2 int8 — the four files the
 * loklm-translator sidecar needs at runtime.
 *
 * These are provisioned by the INSTALLER WIZARD , not the app : the wizard's
 * model-manifest.json carries them in its `common[]` set ( role "translation" ,
 * mirrored to our minio at s3.ltwodl.com/loklm-installers/models/translator/... )
 * and writes them under <install>/models/translator/madlad400-3b-mt-ct2-int8/.
 * The app only LOCATES them ( TranslationService.locateModelDir ) — it never
 * downloads, matching LokLM's principle that large assets land at install time.
 *
 * Sizes pinned from the HuggingFace API on 2026-06-12 and re-verified against
 * the minio mirror on 2026-06-14. The wizard verifies sha256 on download ; the
 * app only needs the filenames + sizes to recognise a complete install.
 */

/** Subdirectory under the models dir holding the CT2 model — must match the
 *  subpath in the wizard manifest's translation `filename` fields. */
export const TRANSLATOR_MODEL_DIRNAME = 'translator/madlad400-3b-mt-ct2-int8'

/** A model file as the app sees it on disk: relative path + expected size.
 *  No URL — the app does not download these (the wizard does). */
export interface TranslatorFile {
  /** Path relative to the models dir, e.g. `${TRANSLATOR_MODEL_DIRNAME}/model.bin`. */
  filename: string
  sizeBytes: number
}

export const TRANSLATOR_FILES: TranslatorFile[] = [
  { filename: `${TRANSLATOR_MODEL_DIRNAME}/model.bin`, sizeBytes: 2_950_208_251 },
  { filename: `${TRANSLATOR_MODEL_DIRNAME}/sentencepiece.model`, sizeBytes: 4_427_844 },
  { filename: `${TRANSLATOR_MODEL_DIRNAME}/shared_vocabulary.json`, sizeBytes: 5_477_099 },
  { filename: `${TRANSLATOR_MODEL_DIRNAME}/config.json`, sizeBytes: 190 },
]

export const TRANSLATOR_TOTAL_BYTES = TRANSLATOR_FILES.reduce((n, f) => n + f.sizeBytes, 0)
