// Offline OCR for scanned PDFs and image files.
//
// Engine: tesseract.js (LSTM, OEM 1) loaded against `best`-quality eng+deu
// traineddata that ships in the installer (build.extraResources → tessdata).
// Nothing here ever touches the network — workerPath / corePath / langPath are
// all resolved to on-disk locations so OCR works on a freshly-installed,
// air-gapped machine.
//
// Rasterisation: PDF pages have no text layer when scanned, so we render them
// to a bitmap with pdfjs + @napi-rs/canvas (sharp can't render PDFs in its
// prebuilt form) and feed the bitmap to tesseract. Standalone images go
// straight through sharp → tesseract.
//
// This module is loaded inside the dedicated `documentsWorker` utilityProcess,
// so all of the CPU-heavy work below stays off the main event loop AND off the
// models worker that streams chat tokens.

import { createRequire } from 'node:module'
import { dirname, join, sep } from 'node:path'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

const requireFromHere = createRequire(import.meta.url)

// Load German + English together so a page mixing both (common in study
// material — German prose quoting English terms) is read correctly. OEM 1 =
// LSTM only, which is what the `best` traineddata contains.
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

// ---- tesseract worker singleton -------------------------------------------

interface TesseractWorker {
  recognize(image: Buffer | string): Promise<{ data: { text: string } }>
  terminate(): Promise<void>
}

let workerPromise: Promise<TesseractWorker> | null = null

async function getWorker(): Promise<TesseractWorker> {
  if (workerPromise) return workerPromise
  workerPromise = (async () => {
    const dir = tessdataDir()
    if (!existsSync(join(dir, 'eng.traineddata')) || !existsSync(join(dir, 'deu.traineddata'))) {
      throw new Error(
        `OCR language data not found in ${dir}. Run "pnpm tessdata" (dev) or check the installer's tessdata resource.`,
      )
    }
    const tesseract = (await import('tesseract.js')) as unknown as {
      createWorker: (
        langs: string,
        oem: number,
        options: Record<string, unknown>,
      ) => Promise<TesseractWorker>
    }
    return tesseract.createWorker(OCR_LANGS, OEM_LSTM_ONLY, {
      langPath: dir,
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
  })()
  try {
    return await workerPromise
  } catch (err) {
    // Reset so a later import retries (e.g. after the user installs tessdata)
    // rather than being stuck on a cached rejection for the whole session.
    workerPromise = null
    throw err
  }
}

/** Dispose the tesseract worker thread. Called on documentsWorker shutdown. */
export async function terminateOcr(): Promise<void> {
  if (!workerPromise) return
  const p = workerPromise
  workerPromise = null
  try {
    const w = await p
    await w.terminate()
  } catch {
    /* worker never came up or already gone — nothing to clean up */
  }
}

// ---- image preprocessing + recognition ------------------------------------

/** Grayscale + contrast-normalise, and upscale small images so tesseract sees
 *  enough pixels per glyph. Rendered PDF pages are already high-res (TARGET_DPI)
 *  so they skip the upscale branch. */
async function preprocess(input: Buffer): Promise<Buffer> {
  const sharp = (await import('sharp')).default
  let img = sharp(input, { failOn: 'none' }).rotate() // honour EXIF orientation
  const meta = await img.metadata()
  const longSide = Math.max(meta.width ?? 0, meta.height ?? 0)
  if (longSide > 0 && longSide < 1500 && meta.width) {
    const factor = Math.min(3, Math.ceil(1500 / longSide))
    img = img.resize({ width: meta.width * factor })
  }
  return img.grayscale().normalize().png().toBuffer()
}

/** OCR a raw image buffer (PNG/JPEG/etc). Returns trimmed text ('' if nothing
 *  legible). Throws if the OCR engine can't initialise (e.g. missing tessdata). */
export async function ocrImageBuffer(input: Buffer): Promise<string> {
  const png = await preprocess(input)
  const worker = await getWorker()
  const { data } = await worker.recognize(png)
  return (data.text ?? '').trim()
}

/** OCR a standalone image file. */
export async function ocrImageFile(filePath: string): Promise<string> {
  return ocrImageBuffer(await readFile(filePath))
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
