import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/types/src/display/api'

// Vite resolves the ?url import to a worker URL the renderer can fetch.
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

type Props = {
  documentId: number
  /** 1-based page number the modal opens focused on. The page gets a visible
   *  accent border and is scrolled into view on mount. */
  targetPage: number
}

type DocCacheEntry = { documentId: number; promise: Promise<PDFDocumentProxy> }

// Cache the PDFDocumentProxy per documentId for the lifetime of the renderer
// process so opening a different chunk of the same doc doesn't re-parse the
// file. The previous single-page preview kept the same cache shape.
let cached: DocCacheEntry | null = null

async function loadPdf(documentId: number): Promise<PDFDocumentProxy> {
  if (cached && cached.documentId === documentId) return cached.promise
  const promise = (async (): Promise<PDFDocumentProxy> => {
    const bytes = await window.api.documents.readDocumentBytes(documentId)
    if (!bytes) throw new Error('Document bytes unavailable')
    // pdfjs takes ownership of the buffer; pass a fresh copy so caching by
    // reference can't blow up later loads.
    const task = pdfjsLib.getDocument({ data: bytes.slice() })
    return task.promise
  })()
  cached = { documentId, promise }
  return promise
}

export function MultiPagePdfPreview({ documentId, targetPage }: Props): JSX.Element {
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

  const pageCount = pdf?.numPages ?? 0
  const safeTarget = Math.min(Math.max(1, targetPage), Math.max(1, pageCount))

  return (
    <div className="pdf-doc">
      {error && <div className="pdf-doc__error">PDF preview failed: {error}</div>}
      {!error && pdf == null && <div className="pdf-doc__loading">Loading PDF…</div>}
      {!error &&
        pdf != null &&
        aspectRatio != null &&
        Array.from({ length: pageCount }, (_, i) => i + 1).map((pageNumber) => (
          <PdfPage
            key={pageNumber}
            pdf={pdf}
            pageNumber={pageNumber}
            aspectRatio={aspectRatio}
            isTarget={pageNumber === safeTarget}
          />
        ))}
    </div>
  )
}

function PdfPage({
  pdf,
  pageNumber,
  aspectRatio,
  isTarget,
}: {
  pdf: PDFDocumentProxy
  pageNumber: number
  aspectRatio: number
  isTarget: boolean
}): JSX.Element {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
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

  // Lazily render pages as they enter the viewport. The target page already
  // has shouldRender=true so it paints immediately on mount.
  useEffect(() => {
    if (shouldRender) return
    const el = wrapRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShouldRender(true)
            io.disconnect()
            break
          }
        }
      },
      { rootMargin: '400px 0px' }, // start rendering a bit before scroll arrival
    )
    io.observe(el)
    return () => io.disconnect()
  }, [shouldRender])

  // Render the actual canvas once shouldRender flips on.
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
        const viewport = page.getViewport({ scale: scale * dpr })

        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`

        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Canvas 2D context unavailable')
        await page.render({ canvasContext: ctx, viewport, canvas }).promise
        if (!cancelled) setRendered(true)
      } catch {
        // Swallow render errors per-page — a broken page shouldn't break the
        // whole modal. The placeholder stays visible.
      }
    })()
    return () => {
      cancelled = true
      activePage?.cleanup()
    }
  }, [shouldRender, rendered, pdf, pageNumber])

  return (
    <div
      ref={wrapRef}
      className={`pdf-doc__page${isTarget ? ' pdf-doc__page--target' : ''}`}
      // Hold the placeholder at the right size while we wait for the canvas
      // to render — otherwise scroll position jumps as pages stream in.
      style={rendered ? undefined : { aspectRatio: `${1 / aspectRatio}` }}
      data-page={pageNumber}
    >
      <div className="pdf-doc__page-label">p. {pageNumber}</div>
      <canvas ref={canvasRef} className={`pdf-doc__page-canvas${rendered ? '' : ' is-hidden'}`} />
      {!rendered && shouldRender && <div className="pdf-doc__page-loading">Rendering…</div>}
    </div>
  )
}
