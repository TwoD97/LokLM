import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/types/src/display/api'

// Vite resolves the ?url import to a worker URL the renderer can fetch.
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

type Props = {
  documentId: number
  pageNumber: number
}

type DocCacheEntry = { documentId: number; promise: Promise<PDFDocumentProxy> }

// Cache the PDFDocumentProxy per documentId for the lifetime of the renderer
// process so flipping between chunks of the same doc doesn't re-parse the file.
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

export function PdfPagePreview({ documentId, pageNumber }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rendering, setRendering] = useState(true)

  useEffect(() => {
    let cancelled = false
    let activePage: PDFPageProxy | null = null
    setError(null)
    setRendering(true)

    void (async () => {
      try {
        const pdf = await loadPdf(documentId)
        if (cancelled) return
        const safePage = Math.min(Math.max(1, pageNumber), pdf.numPages)
        const page = await pdf.getPage(safePage)
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
        if (!cancelled) setRendering(false)
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setRendering(false)
        }
      }
    })()

    return () => {
      cancelled = true
      activePage?.cleanup()
    }
  }, [documentId, pageNumber])

  return (
    <div ref={wrapRef} className="pdf-page">
      {error && <div className="pdf-page__error">PDF-Vorschau fehlgeschlagen: {error}</div>}
      {!error && rendering && <div className="pdf-page__loading">Seite wird geladen …</div>}
      <canvas ref={canvasRef} className={`pdf-page__canvas ${error ? 'is-hidden' : ''}`} />
    </div>
  )
}
