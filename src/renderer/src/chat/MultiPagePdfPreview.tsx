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
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist/types/src/display/api'
import { findFuzzyHighlights } from '@shared/fuzzyHighlight'
import { useT } from '../i18n'

/** One IntersectionObserver shared across every PdfPage in a single document
 *  preview — a 200-page PDF used to spawn 200 observers, this collapses to one.
 *  Pages register their root element + an onVisible callback; the registry
 *  fires the callback once and auto-unobserves. */
type VisibilityRegister = (el: Element, onVisible: () => void) => () => void
const VisibilityContext = createContext<VisibilityRegister | null>(null)
const EMPTY_SNIPPETS: string[] = []

type RenderedPage = {
  page: PDFPageProxy
  viewport: ReturnType<PDFPageProxy['getViewport']>
  textTasks: Set<Promise<void>>
}

function createVisibilityRegistry(): { register: VisibilityRegister; dispose: () => void } {
  const callbacks = new Map<Element, () => void>()
  let io: IntersectionObserver | null = null
  const observer = (): IntersectionObserver =>
    (io ??= new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const cb = callbacks.get(entry.target)
          if (!cb) continue
          callbacks.delete(entry.target)
          io?.unobserve(entry.target)
          cb()
        }
      },
      { rootMargin: '400px 0px' }, // start rendering a bit before scroll arrival
    ))
  return {
    register: (el, onVisible) => {
      callbacks.set(el, onVisible)
      observer().observe(el)
      return () => {
        if (callbacks.delete(el)) io?.unobserve(el)
      }
    },
    dispose: () => {
      callbacks.clear()
      io?.disconnect()
      io = null
    },
  }
}

// Vite resolves the ?url import to a worker URL the renderer can fetch.
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

type Props = {
  /** Bytes verified against the indexed source hash by the source reader. */
  bytes: Uint8Array
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

export function MultiPagePdfPreview({
  bytes,
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
    let task: ReturnType<typeof pdfjsLib.getDocument> | undefined
    setError(null)
    setPdf(null)
    setAspectRatio(null)
    void (async () => {
      try {
        // Let an abandoned StrictMode effect clean up before starting a worker.
        await Promise.resolve()
        if (cancelled) return
        // The preview owns its worker and decrypted bytes. Document IDs are
        // local to each workspace, so a renderer-wide ID cache is unsafe.
        // PDF.js transfers its buffer to the worker; preserve the owner's copy
        // so a remount or StrictMode replay cannot reuse a detached buffer.
        task = pdfjsLib.getDocument({ data: bytes.slice() })
        const doc = await task.promise
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
      void task?.destroy().catch(() => undefined)
    }
  }, [bytes])

  // One IntersectionObserver shared by every page of this preview. Created
  // per-mount and created lazily when a page registers. This also avoids
  // allocating an observer during an abandoned React render.
  const visibility = useMemo(() => createVisibilityRegistry(), [])
  useEffect(() => () => visibility.dispose(), [visibility])

  const pageCount = pdf?.numPages ?? 0
  const safeTarget = Math.min(Math.max(1, targetPage), Math.max(1, pageCount))
  const highlightSnippets = snippets ?? EMPTY_SNIPPETS
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
                snippets={inCitedRange ? highlightSnippets : EMPTY_SNIPPETS}
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
  const [renderedPage, setRenderedPage] = useState<RenderedPage | null>(null)
  const rasterSettled = useRef<Promise<void>>(Promise.resolve())
  const rendered = renderedPage !== null

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

  // Rasterization belongs to the page, not to its highlights. A parent render
  // or a different answer's snippets must not start another task on its canvas.
  useEffect(() => {
    if (!shouldRender) return
    let cancelled = false
    let activePage: PDFPageProxy | null = null
    let renderTask: RenderTask | null = null
    const textTasks = new Set<Promise<void>>()
    const previousRaster = rasterSettled.current
    setRenderedPage(null)
    const completion = (async () => {
      try {
        // Cancellation relinquishes the canvas, and its promise confirms that
        // the previous task has settled before this effect can reuse it.
        await previousRaster
        if (cancelled) return
        const page = await pdf.getPage(pageNumber)
        activePage = page
        if (cancelled) return
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
        renderTask = page.render({ canvasContext: ctx, viewport: renderViewport, canvas })
        try {
          await renderTask.promise
        } finally {
          renderTask = null
        }
        if (cancelled) return
        setRenderedPage({ page, viewport: cssViewport, textTasks })
      } catch {
        // Swallow render errors per-page — a broken page shouldn't break the
        // whole modal. The placeholder stays visible.
      }
    })()
    rasterSettled.current = completion
    return () => {
      cancelled = true
      renderTask?.cancel()
      // A text layer can still be settling after its own effect cleanup.
      // Release page resources only after both kinds of owned work finish.
      void completion
        .then(async () => {
          await Promise.allSettled(textTasks)
          activePage?.cleanup()
        })
        .catch(() => undefined)
    }
  }, [shouldRender, pdf, pageNumber])

  // Highlights can change independently of a finished canvas. Cancel the old
  // text task and clear its marks before starting the current answer's layer.
  useEffect(() => {
    const host = textLayerRef.current
    if (!host || !renderedPage) return
    const { page, viewport, textTasks } = renderedPage
    if (snippets.length === 0) {
      if (textTasks.size === 0) page.cleanup()
      return
    }
    // PDF.js may deliver an already-queued read after cancel(). Give each task
    // its own node so any such late writes stay detached from the current layer.
    // Keep the original textLayer class/positioning on that actual PDF.js node.
    const container = document.createElement('div')
    container.className = 'pdf-doc__text-layer textLayer'
    host.append(container)
    let cancelled = false
    let textLayer: pdfjsLib.TextLayer | null = null
    const completion = (async () => {
      try {
        container.style.setProperty('--total-scale-factor', String(viewport.scale))
        container.style.width = `${Math.floor(viewport.width)}px`
        container.style.height = `${Math.floor(viewport.height)}px`
        textLayer = new pdfjsLib.TextLayer({
          textContentSource: page.streamTextContent(),
          container,
          viewport,
        })
        await textLayer.render()
        if (!cancelled) highlightTextLayer(textLayer, snippets)
      } catch {
        // A cancelled or unavailable text layer must not hide the PDF canvas.
      }
    })()
    textTasks.add(completion)
    void completion.then(() => {
      textTasks.delete(completion)
      if (textTasks.size === 0) page.cleanup()
    })
    return () => {
      cancelled = true
      textLayer?.cancel()
      container.remove()
    }
  }, [renderedPage, snippets])

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
      <div ref={textLayerRef} className="pdf-doc__text-layer-host" aria-hidden="true" />
      {!rendered && shouldRender && (
        <div className="pdf-doc__page-loading">{t('chat.rendering')}</div>
      )}
    </div>
  )
}

/**
 * Marks the already-rendered PDF.js text divs whose
 * normalised content fuzzy-matches any of the supplied `snippets`. A whole
 * textDiv is marked even if only part of its run overlaps a highlight range —
 * PDF text items are already short fragments (often a single line or word),
 * so the visual result stays close to a per-phrase highlight without the cost
 * of splitting divs along character offsets.
 */
function highlightTextLayer(textLayer: pdfjsLib.TextLayer, snippets: string[]): void {
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
