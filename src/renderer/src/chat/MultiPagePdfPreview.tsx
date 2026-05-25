import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/types/src/display/api'
import { findFuzzyHighlights } from '@shared/fuzzyHighlight'
import { useT } from '../i18n'

/** One IntersectionObserver shared across every PdfPage in a single document
 *  preview — a 200-page PDF used to spawn 200 observers, this collapses to one.
 *  Pages register their root element + an onVisible callback; the registry
 *  fires the callback once and auto-unobserves. */
type VisibilityRegister = (el: Element, onVisible: () => void) => () => void
const VisibilityContext = createContext<VisibilityRegister | null>(null)

function createVisibilityRegistry(): { register: VisibilityRegister; dispose: () => void } {
  const callbacks = new Map<Element, () => void>()
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const cb = callbacks.get(entry.target)
        if (!cb) continue
        callbacks.delete(entry.target)
        io.unobserve(entry.target)
        cb()
      }
    },
    { rootMargin: '400px 0px' }, // start rendering a bit before scroll arrival
  )
  return {
    register: (el, onVisible) => {
      callbacks.set(el, onVisible)
      io.observe(el)
      return () => {
        if (callbacks.delete(el)) io.unobserve(el)
      }
    },
    dispose: () => {
      callbacks.clear()
      io.disconnect()
    },
  }
}

// Vite resolves the ?url import to a worker URL the renderer can fetch.
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

type Props = {
  documentId: number
  /** 1-based page number the modal opens focused on. The page gets a visible
   *  accent border and is scrolled into view on mount. */
  targetPage: number
  /** Sentences from the assistant answer that cite this chunk. Used to
   *  fuzzy-highlight matching spans in the rendered PDF text layer. Empty when
   *  the modal is opened without a message context. */
  snippets?: string[]
  /** Inclusive page range the cited chunk covers — text-layer highlighting is
   *  scoped to these pages so paraphrases that happen to occur elsewhere in the
   *  document don't get marked as if they were the source. */
  citedPageFrom?: number
  citedPageTo?: number
}

type DocCacheEntry = { documentId: number; promise: Promise<PDFDocumentProxy> }

// Cache the PDFDocumentProxy per documentId for the lifetime of the renderer
// process so opening a different chunk of the same doc doesn't re-parse the
// file. The previous single-page preview kept the same cache shape.
let cached: DocCacheEntry | null = null

async function loadPdf(documentId: number): Promise<PDFDocumentProxy> {
  if (cached && cached.documentId === documentId) return cached.promise
  // Free the previous doc's parsed structure + worker-side buffers before
  // swapping , otherwise opening N different PDFs leaks N-1 of them.
  if (cached) {
    const stale = cached.promise
    void stale.then((p) => p.destroy()).catch(() => undefined)
  }
  const promise = (async (): Promise<PDFDocumentProxy> => {
    const bytes = await window.api.documents.readDocumentBytes(documentId)
    if (!bytes) throw new Error('Document bytes unavailable')
    // readDocumentBytes returns a fresh Uint8Array per IPC call , no need to
    // copy. pdfjs detaches the underlying ArrayBuffer.
    const task = pdfjsLib.getDocument({ data: bytes })
    return task.promise
  })()
  cached = { documentId, promise }
  return promise
}

export function MultiPagePdfPreview({
  documentId,
  targetPage,
  snippets,
  citedPageFrom,
  citedPageTo,
}: Props): JSX.Element {
  const t = useT()
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [aspectRatio, setAspectRatio] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Load doc + read page 1's viewport to size the placeholders. We assume all
  // pages share aspect ratio (close enough for placeholder height — actual
  // render uses the page's own viewport so the canvas always matches).
  useEffect(() => {
    let cancelled = false
    setError(null)
    setPdf(null)
    setAspectRatio(null)
    void (async () => {
      try {
        const doc = await loadPdf(documentId)
        if (cancelled) return
        const probe = await doc.getPage(1)
        if (cancelled) {
          probe.cleanup()
          return
        }
        const v = probe.getViewport({ scale: 1 })
        setAspectRatio(v.height / v.width)
        probe.cleanup()
        setPdf(doc)
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [documentId])

  // One IntersectionObserver shared by every page of this preview. Created
  // per-mount (one preview = one document = one observer) and torn down when
  // the modal closes or the document changes.
  const visibility = useMemo(() => createVisibilityRegistry(), [])
  useEffect(() => () => visibility.dispose(), [visibility])

  const pageCount = pdf?.numPages ?? 0
  const safeTarget = Math.min(Math.max(1, targetPage), Math.max(1, pageCount))
  const highlightSnippets = snippets ?? []
  const rangeFrom = citedPageFrom ?? safeTarget
  const rangeTo = citedPageTo ?? rangeFrom

  return (
    <VisibilityContext.Provider value={visibility.register}>
      <div className="pdf-doc">
        {error && (
          <div className="pdf-doc__error">{t('chat.pdfPreviewFailed', { message: error })}</div>
        )}
        {!error && pdf == null && <div className="pdf-doc__loading">{t('chat.loadingPdf')}</div>}
        {!error &&
          pdf != null &&
          aspectRatio != null &&
          Array.from({ length: pageCount }, (_, i) => i + 1).map((pageNumber) => {
            const inCitedRange = pageNumber >= rangeFrom && pageNumber <= rangeTo
            return (
              <PdfPage
                key={pageNumber}
                pdf={pdf}
                pageNumber={pageNumber}
                aspectRatio={aspectRatio}
                isTarget={pageNumber === safeTarget}
                snippets={inCitedRange ? highlightSnippets : []}
              />
            )
          })}
      </div>
    </VisibilityContext.Provider>
  )
}

function PdfPage({
  pdf,
  pageNumber,
  aspectRatio,
  isTarget,
  snippets,
}: {
  pdf: PDFDocumentProxy
  pageNumber: number
  aspectRatio: number
  isTarget: boolean
  /** Snippets to fuzzy-highlight on this specific page. Empty when the page is
   *  outside the cited range or no message context was passed in. */
  snippets: string[]
}): JSX.Element {
  const t = useT()
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const textLayerRef = useRef<HTMLDivElement | null>(null)
  const [shouldRender, setShouldRender] = useState(isTarget)
  const [rendered, setRendered] = useState(false)

  // Scroll the cited page into view as soon as its placeholder is mounted.
  // Layout effect so the modal doesn't show a flash of the first page first.
  useLayoutEffect(() => {
    if (!isTarget) return
    const el = wrapRef.current
    if (!el) return
    el.scrollIntoView({ block: 'start', behavior: 'auto' })
  }, [isTarget])

  const register = useContext(VisibilityContext)

  // Lazily render pages as they enter the viewport via the shared
  // IntersectionObserver registered by MultiPagePdfPreview. The target page
  // already has shouldRender=true so it paints immediately on mount and skips
  // observation entirely.
  useEffect(() => {
    if (shouldRender || !register) return
    const el = wrapRef.current
    if (!el) return
    return register(el, () => setShouldRender(true))
  }, [shouldRender, register])

  // Render the actual canvas (and , when this page is in the cited range , the
  // text-layer overlay that hosts the snippet highlights) once shouldRender
  // flips on.
  useEffect(() => {
    if (!shouldRender || rendered) return
    let cancelled = false
    let activePage: PDFPageProxy | null = null
    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber)
        if (cancelled) {
          page.cleanup()
          return
        }
        activePage = page
        const canvas = canvasRef.current
        const wrap = wrapRef.current
        if (!canvas || !wrap) return

        const containerWidth = wrap.clientWidth || 600
        const unscaled = page.getViewport({ scale: 1 })
        const scale = containerWidth / unscaled.width
        const dpr = window.devicePixelRatio || 1
        const cssViewport = page.getViewport({ scale })
        const renderViewport = page.getViewport({ scale: scale * dpr })

        canvas.width = Math.floor(renderViewport.width)
        canvas.height = Math.floor(renderViewport.height)
        canvas.style.width = `${Math.floor(cssViewport.width)}px`
        canvas.style.height = `${Math.floor(cssViewport.height)}px`

        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Canvas 2D context unavailable')
        await page.render({ canvasContext: ctx, viewport: renderViewport, canvas }).promise
        if (cancelled) return

        // Text-layer overlay — only paint it when we have snippets to mark.
        // Skipping the work on uncited pages keeps the modal light.
        const textLayerEl = textLayerRef.current
        if (textLayerEl && snippets.length > 0) {
          await renderTextLayerWithHighlights({
            page,
            container: textLayerEl,
            viewport: cssViewport,
            snippets,
          })
          if (cancelled) return
        }

        setRendered(true)
      } catch {
        // Swallow render errors per-page — a broken page shouldn't break the
        // whole modal. The placeholder stays visible.
      }
    })()
    return () => {
      cancelled = true
      activePage?.cleanup()
    }
  }, [shouldRender, rendered, pdf, pageNumber, snippets])

  return (
    <div
      ref={wrapRef}
      className={`pdf-doc__page${isTarget ? ' pdf-doc__page--target' : ''}`}
      // Hold the placeholder at the right size while we wait for the canvas
      // to render — otherwise scroll position jumps as pages stream in.
      style={rendered ? undefined : { aspectRatio: `${1 / aspectRatio}` }}
      data-page={pageNumber}
    >
      <div className="pdf-doc__page-label">{t('chat.pageLabel', { n: pageNumber })}</div>
      <canvas ref={canvasRef} className={`pdf-doc__page-canvas${rendered ? '' : ' is-hidden'}`} />
      <div ref={textLayerRef} className="pdf-doc__text-layer textLayer" aria-hidden="true" />
      {!rendered && shouldRender && (
        <div className="pdf-doc__page-loading">{t('chat.rendering')}</div>
      )}
    </div>
  )
}

/**
 * Renders the PDF.js text layer into `container` and marks the text divs whose
 * normalised content fuzzy-matches any of the supplied `snippets`. A whole
 * textDiv is marked even if only part of its run overlaps a highlight range —
 * PDF text items are already short fragments (often a single line or word),
 * so the visual result stays close to a per-phrase highlight without the cost
 * of splitting divs along character offsets.
 */
async function renderTextLayerWithHighlights({
  page,
  container,
  viewport,
  snippets,
}: {
  page: PDFPageProxy
  container: HTMLDivElement
  viewport: ReturnType<PDFPageProxy['getViewport']>
  snippets: string[]
}): Promise<void> {
  container.replaceChildren()
  // pdfjs-dist 5.x positions each span via CSS variables driven by this one.
  container.style.setProperty('--total-scale-factor', String(viewport.scale))
  container.style.width = `${Math.floor(viewport.width)}px`
  container.style.height = `${Math.floor(viewport.height)}px`

  const textLayer = new pdfjsLib.TextLayer({
    textContentSource: page.streamTextContent(),
    container,
    viewport,
  })
  await textLayer.render()

  const items = textLayer.textContentItemsStr
  const divs = textLayer.textDivs
  if (items.length === 0 || divs.length === 0) return

  // Concatenate the item strings with a single-space separator and remember
  // each item's start offset in the combined string. The token-shingle matcher
  // is built for normal prose , a space-joined item stream is close enough.
  const offsets: number[] = new Array(items.length)
  let combined = ''
  for (let i = 0; i < items.length; i++) {
    offsets[i] = combined.length
    combined += items[i] ?? ''
    if (i < items.length - 1) combined += ' '
  }

  const ranges = findFuzzyHighlights(combined, snippets)
  if (ranges.length === 0) return

  // Walk items + ranges together once. Both are in offset order , so a single
  // pointer into `ranges` is enough.
  let rangeIdx = 0
  for (let i = 0; i < items.length; i++) {
    const itemStart = offsets[i]!
    const itemEnd = itemStart + (items[i]?.length ?? 0)
    while (rangeIdx < ranges.length && ranges[rangeIdx]!.end <= itemStart) rangeIdx++
    if (rangeIdx >= ranges.length) break
    const r = ranges[rangeIdx]!
    if (r.start < itemEnd && r.end > itemStart) {
      divs[i]?.classList.add('pdf-doc__page-mark')
    }
  }
}
