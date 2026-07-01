// Offline OCR for scanned PDFs and image files.
//
// Engine: tesseract.js (LSTM, OEM 1) loaded against `fast` (integer-LSTM)
// eng+deu traineddata that ships in the installer (build.extraResources →
// tessdata). `fast` recognises roughly 3-4× quicker than the float `best`
// models at a small accuracy cost — the right trade-off for indexing whole
// scanned documents. Nothing here ever touches the network — workerPath /
// corePath / langPath are all resolved to on-disk locations so OCR works on a
// freshly-installed, air-gapped machine.
//
// Rasterisation: PDF pages have no text layer when scanned, so we render them
// to a bitmap with pdfjs + @napi-rs/canvas (sharp can't render PDFs in its
// prebuilt form) and feed the bitmap to tesseract. Standalone images go
// straight through sharp → tesseract.
//
// This module is loaded inside the dedicated `documentsWorker` utilityProcess,
// so all of the CPU-heavy work below stays off the main event loop AND off the
// models worker that streams chat tokens. Recognition itself fans out to a
// small pool of tesseract worker threads (a tesseract.js scheduler), sized to
// the number of concurrent callers — see MAX_OCR_WORKERS.

import { createRequire } from 'node:module'
import { dirname, join, sep } from 'node:path'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { availableParallelism } from 'node:os'

const requireFromHere = createRequire(import.meta.url)

// Load German + English together so a page mixing both (common in study
// material — German prose quoting English terms) is read correctly. OEM 1 =
// LSTM only, which is what the `fast` traineddata contains.
const OCR_LANGS = 'deu+eng'
const OEM_LSTM_ONLY = 1

// Render scanned pages at ~300 DPI (PDF user space is 72 units/inch). Higher
// DPI improves OCR accuracy on small fonts; the cap keeps a giant A0 poster
// from allocating a multi-hundred-megapixel canvas.
const TARGET_DPI = 300
const MAX_RENDER_SIDE_PX = 4000

// Below this many non-whitespace characters a PDF page is treated as having no
// real text layer (i.e. it's a scan) and is sent to OCR. Empirically a genuine
// text page clears this by orders of magnitude; a scanned page extracts 0–a
// few stray ligatures.
export const OCR_MIN_PAGE_CHARS = 16

/** True when an extracted PDF page is sparse enough to be considered a scan. */
export function pageNeedsOcr(text: string): boolean {
  return text.trim().length < OCR_MIN_PAGE_CHARS
}

// ---- path resolution ------------------------------------------------------

/** Directory holding eng.traineddata / deu.traineddata. Main sets
 *  LOKLM_TESSDATA_DIR (packaged → resources/tessdata, dev → repo/tessdata) and
 *  the worker inherits it; vitest/node fall back to <cwd>/tessdata. */
function tessdataDir(): string {
  const env = process.env['LOKLM_TESSDATA_DIR']
  if (env && env.length > 0) return env
  return join(process.cwd(), 'tessdata')
}

// electron-builder unpacks the tesseract worker script + wasm core out of the
// asar (build.asarUnpack), but require.resolve still returns the in-asar path.
// Spawning a worker thread and instantiating wasm both need the real file, so
// redirect app.asar → app.asar.unpacked. No-op in dev (no asar in the path).
function asarUnpacked(p: string): string {
  return p
    .replace(`app.asar${sep}`, `app.asar.unpacked${sep}`)
    .replace('app.asar/', 'app.asar.unpacked/')
}

function tesseractWorkerPath(): string {
  const pkgRoot = dirname(requireFromHere.resolve('tesseract.js/package.json'))
  return asarUnpacked(join(pkgRoot, 'src', 'worker-script', 'node', 'index.js'))
}

function tesseractCorePath(): string {
  // tesseract.js-core is a transitive dep of tesseract.js; pnpm doesn't hoist
  // it, so resolve it relative to tesseract.js rather than from here.
  const tjsEntry = requireFromHere.resolve('tesseract.js')
  const corePkgJson = createRequire(tjsEntry).resolve('tesseract.js-core/package.json')
  return asarUnpacked(dirname(corePkgJson))
}

// ---- tesseract scheduler pool ----------------------------------------------

interface TesseractWorker {
  recognize(image: Buffer | string): Promise<{ data: { text: string } }>
  terminate(): Promise<void>
}

interface TesseractScheduler {
  addWorker(worker: TesseractWorker): string
  addJob(action: 'recognize', image: Buffer | string): Promise<{ data: { text: string } }>
  terminate(): Promise<void>
}

interface TesseractModule {
  createWorker(
    langs: string,
    oem: number,
    options: Record<string, unknown>,
  ): Promise<TesseractWorker>
  createScheduler(): TesseractScheduler
}

// Recognition is pure WASM number-crunching: one fully-busy thread per worker.
// Cap the pool so rasterisation (pdfjs), sharp and the rest of the app keep
// breathing room, and never oversubscribe a small machine.
const MAX_OCR_WORKERS = Math.max(1, Math.min(4, availableParallelism() - 2))

/** Concurrency to use for `jobs` independent OCR jobs. Pure — never touches
 *  the engine, so callers (parser page pools) can size themselves without
 *  initialising OCR first. */
export function ocrConcurrency(jobs: number): number {
  return Math.max(1, Math.min(MAX_OCR_WORKERS, jobs))
}

let pool: { scheduler: TesseractScheduler; workers: number } | null = null
// Serialises pool mutations (spawn / terminate) so concurrent recognitions
// don't over-spawn. A promise chain acts as the mutex; the chain itself
// swallows rejections — each caller still sees the rejection on its own link.
let poolChain: Promise<unknown> = Promise.resolve()
// Recognitions currently awaited — drives on-demand worker spawning.
let inFlight = 0

function assertTessdata(): string {
  const dir = tessdataDir()
  if (!existsSync(join(dir, 'eng.traineddata')) || !existsSync(join(dir, 'deu.traineddata'))) {
    throw new Error(
      `OCR language data not found in ${dir}. Run "pnpm tessdata" (dev) or check the installer's tessdata resource.`,
    )
  }
  return dir
}

function createTessWorker(tesseract: TesseractModule, langPath: string): Promise<TesseractWorker> {
  return tesseract.createWorker(OCR_LANGS, OEM_LSTM_ONLY, {
    langPath,
    // Our traineddata is stored uncompressed and read straight from langPath;
    // 'none' stops tesseract from trying to write a cache copy elsewhere.
    gzip: false,
    cacheMethod: 'none',
    workerPath: tesseractWorkerPath(),
    corePath: tesseractCorePath(),
    logger: () => {},
    errorHandler: (e: unknown) =>
      // eslint-disable-next-line no-console
      console.warn('[ocr] tesseract worker error:', e instanceof Error ? e.message : e),
  })
}

/** Grow the pool to min(MAX_OCR_WORKERS, target) workers. Missing tessdata or
 *  a total spawn failure throws but leaves the pool retryable (e.g. after the
 *  user installs tessdata); a partial spawn failure degrades to fewer workers
 *  with a warning. */
async function ensureWorkers(target: number): Promise<TesseractScheduler> {
  const want = ocrConcurrency(target)
  const run = poolChain.then(async () => {
    if (pool && pool.workers >= want) return pool.scheduler
    const langPath = assertTessdata()
    const tesseract = (await import('tesseract.js')) as unknown as TesseractModule
    if (!pool) pool = { scheduler: tesseract.createScheduler(), workers: 0 }
    const spawned = await Promise.allSettled(
      Array.from({ length: want - pool.workers }, () => createTessWorker(tesseract, langPath)),
    )
    let firstFailure: unknown
    for (const s of spawned) {
      if (s.status === 'fulfilled') {
        pool.scheduler.addWorker(s.value)
        pool.workers += 1
      } else {
        firstFailure = firstFailure ?? s.reason
      }
    }
    if (pool.workers === 0) {
      throw firstFailure instanceof Error ? firstFailure : new Error(String(firstFailure))
    }
    if (firstFailure !== undefined) {
      // eslint-disable-next-line no-console
      console.warn(
        `[ocr] some OCR workers failed to spawn, continuing with ${pool.workers}:`,
        firstFailure instanceof Error ? firstFailure.message : firstFailure,
      )
    }
    return pool.scheduler
  })
  poolChain = run.catch(() => {})
  return run
}

/** Recognise a preprocessed PNG on the pool. The pool grows to match the
 *  number of concurrent callers (capped at MAX_OCR_WORKERS), so a single image
 *  costs one worker while a scanned book fans out to the full pool. */
async function recognize(png: Buffer): Promise<string> {
  inFlight += 1
  try {
    const scheduler = await ensureWorkers(inFlight)
    const { data } = await scheduler.addJob('recognize', png)
    return (data.text ?? '').trim()
  } finally {
    inFlight -= 1
  }
}

/** Dispose the tesseract worker pool. Called on documentsWorker shutdown. */
export async function terminateOcr(): Promise<void> {
  const run = poolChain.then(async () => {
    if (!pool) return
    const p = pool
    pool = null
    try {
      await p.scheduler.terminate() // terminates every worker in the pool
    } catch {
      /* workers never came up or already gone — nothing to clean up */
    }
  })
  poolChain = run.catch(() => {})
  await run
}

// ---- image preprocessing + recognition ------------------------------------

/** Grayscale, and upscale small images so tesseract sees enough pixels per
 *  glyph. Rendered PDF pages are already high-res (TARGET_DPI) so they skip
 *  the upscale branch.
 *
 *  Deliberately NO normalize(): libvips' histogram stretch costs ~5× the rest
 *  of this pipeline combined, doesn't parallelise across concurrent pipelines
 *  (it starved the OCR worker pool), and tesseract binarises with its own
 *  adaptive Otsu pass anyway — low-contrast input recognises just as well
 *  without it. PNG compressionLevel 1 over the default 6 for the same reason:
 *  the buffer only crosses a thread boundary, it never hits disk. */
async function preprocess(input: Buffer): Promise<Buffer> {
  const sharp = (await import('sharp')).default
  let img = sharp(input, { failOn: 'none' }).rotate() // honour EXIF orientation
  const meta = await img.metadata()
  const longSide = Math.max(meta.width ?? 0, meta.height ?? 0)
  if (longSide > 0 && longSide < 1500 && meta.width) {
    const factor = Math.min(3, Math.ceil(1500 / longSide))
    img = img.resize({ width: meta.width * factor })
  }
  return img.grayscale().png({ compressionLevel: 1 }).toBuffer()
}

/** OCR a raw image buffer (PNG/JPEG/etc). Returns trimmed text ('' if nothing
 *  legible). Throws if the OCR engine can't initialise (e.g. missing tessdata). */
export async function ocrImageBuffer(input: Buffer): Promise<string> {
  const png = await preprocess(input)
  return recognize(png)
}

/** OCR a standalone image file. */
export async function ocrImageFile(filePath: string): Promise<string> {
  return ocrImageBuffer(await readFile(filePath))
}

// Embedded images below this long side are bullets / icons / small logos; a
// scan or screenshot with legible text is practically always bigger.
const MIN_EMBEDDED_IMAGE_SIDE_PX = 128

/** OCR a batch of images embedded in a document (e.g. .docx) in parallel on
 *  the worker pool. Best-effort by design: a slot comes back '' when its image
 *  is too small, undecodable (EMF/WMF vector parts), or fails to recognise —
 *  unlike a standalone image file, an embedded image is rarely the document's
 *  only content, so the surrounding import must survive. */
export async function ocrEmbeddedImages(
  images: Buffer[],
  onProgress?: (done: number, total: number) => void,
): Promise<string[]> {
  const out = new Array<string>(images.length).fill('')
  if (images.length === 0) return out
  let next = 0
  let done = 0
  const runner = async (): Promise<void> => {
    for (;;) {
      const i = next
      next += 1
      const image = images[i]
      if (image === undefined) return
      try {
        if (await isOcrCandidate(image)) out[i] = await ocrImageBuffer(image)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[ocr] embedded image ${i + 1}/${images.length} failed:`,
          err instanceof Error ? err.message : err,
        )
      } finally {
        done += 1
        onProgress?.(done, images.length)
      }
    }
  }
  await Promise.all(Array.from({ length: ocrConcurrency(images.length) }, runner))
  return out
}

/** Cheap metadata-only probe: decodable by sharp and big enough to hold text. */
async function isOcrCandidate(input: Buffer): Promise<boolean> {
  try {
    const sharp = (await import('sharp')).default
    const meta = await sharp(input, { failOn: 'none' }).metadata()
    return Math.max(meta.width ?? 0, meta.height ?? 0) >= MIN_EMBEDDED_IMAGE_SIDE_PX
  } catch {
    return false
  }
}

// ---- scanned-PDF page rasterisation ---------------------------------------

/** Minimal slice of pdfjs's PDFPageProxy we use. parser.ts hands us the page
 *  objects from the document pdf-parse already loaded, so we don't import or
 *  re-instantiate pdfjs here. */
export interface PdfPageLike {
  getViewport(opts: { scale: number }): { width: number; height: number }
  render(opts: { canvasContext: unknown; viewport: unknown }): { promise: Promise<void> }
  cleanup?: () => void
}

let canvasGlobalsInstalled = false

/** pdfjs references DOMMatrix / Path2D / ImageData as globals while rendering.
 *  The documentsWorker installs a no-op DOMMatrix at import time so pdf-parse
 *  can be imported in a context without a DOM; here we replace those globals
 *  with the real @napi-rs/canvas implementations now that we actually
 *  rasterise. Lazy so a text-only PDF never loads the native canvas binding. */
async function installCanvasGlobals(): Promise<void> {
  if (canvasGlobalsInstalled) return
  const canvas = await import('@napi-rs/canvas')
  const g = globalThis as Record<string, unknown>
  g['DOMMatrix'] = canvas.DOMMatrix
  g['Path2D'] = canvas.Path2D
  g['ImageData'] = canvas.ImageData
  canvasGlobalsInstalled = true
}

/** pdfjs's BaseCanvasFactory shape: the object create() hands back and that
 *  reset()/destroy() later mutate. */
interface CanvasAndContext {
  canvas: { width: number; height: number } | null
  context: unknown
}

/**
 * pdfjs auto-selects its DOMCanvasFactory inside the documentsWorker because its
 * `isNodeJS` guard treats an Electron utilityProcess (process.type === 'utility')
 * as a browser. DOMCanvasFactory calls `document.createElement('canvas')`, which
 * throws ("Cannot read properties of undefined (reading 'createElement')") in a
 * worker with no DOM — so any scanned page that needs an auxiliary canvas (soft
 * masks, transparency groups, tiling patterns) failed to rasterise. We pass this
 * @napi-rs/canvas-backed factory to getDocument (via pdf-parse) instead. Mirrors
 * pdfjs's own NodeCanvasFactory; the native binding is require()'d lazily inside
 * create(), so a text-only PDF that never renders a page still never loads it.
 */
export class NodeCanvasFactory {
  create(width: number, height: number): CanvasAndContext {
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size')
    const { createCanvas } = requireFromHere('@napi-rs/canvas') as typeof import('@napi-rs/canvas')
    const canvas = createCanvas(width, height)
    return { canvas, context: canvas.getContext('2d') }
  }

  reset(cc: CanvasAndContext, width: number, height: number): void {
    if (!cc.canvas) throw new Error('Canvas is not specified')
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size')
    cc.canvas.width = width
    cc.canvas.height = height
  }

  destroy(cc: CanvasAndContext): void {
    if (!cc.canvas) return
    cc.canvas.width = 0
    cc.canvas.height = 0
    cc.canvas = null
    cc.context = null
  }
}

/** Render one PDF page to a white-backed PNG and OCR it. */
export async function ocrPdfPage(page: PdfPageLike): Promise<string> {
  await installCanvasGlobals()
  const { createCanvas } = await import('@napi-rs/canvas')

  const base = page.getViewport({ scale: 1 })
  let scale = TARGET_DPI / 72
  const longest = Math.max(base.width, base.height)
  if (longest * scale > MAX_RENDER_SIDE_PX) scale = MAX_RENDER_SIDE_PX / longest
  const viewport = page.getViewport({ scale })

  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  const ctx = canvas.getContext('2d')
  // PDF pages render with a transparent background; flatten to white so OCR
  // doesn't see text on black/alpha.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport }).promise
  page.cleanup?.()

  return ocrImageBuffer(canvas.toBuffer('image/png'))
}
