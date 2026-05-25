import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChunkSource, DocumentChunk } from '@shared/documents'
import { extractCitationSnippets } from '@shared/citationContext'
import { applyHighlights, findFuzzyHighlights } from '@shared/fuzzyHighlight'
import { MultiPagePdfPreview } from './MultiPagePdfPreview'
import { useT } from '../i18n'

type Props = {
  chunkId: number
  documentTitle?: string | null
  /** Full text of the assistant message that owns the clicked citation. Used to
   *  extract the surrounding sentence(s) and fuzzy-highlight them inside the
   *  cited chunk. When null (e.g. opened from a context where the message text
   *  isn't available) , the modal still renders the document but skips
   *  highlighting. */
  messageText?: string | null
  onClose: () => void
}

type BodyMode = 'pdf' | 'markdown' | 'text'
type LoadStatus = 'loading' | 'ready' | 'error'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function classifySource(source: ChunkSource | null): BodyMode {
  if (!source) return 'text'
  const path = (source.sourcePath ?? '').toLowerCase()
  if (source.mimeType === 'application/pdf' || path.endsWith('.pdf')) return 'pdf'
  // .docx is mammoth-converted to markdown at parse time — same render path as .md.
  if (source.mimeType === DOCX_MIME || path.endsWith('.docx')) return 'markdown'
  if (path.endsWith('.md') || path.endsWith('.markdown')) return 'markdown'
  return 'text'
}

function formatPageRange(source: ChunkSource | null): string | null {
  if (!source || source.chunkPageFrom == null) return null
  if (source.chunkPageTo == null || source.chunkPageTo === source.chunkPageFrom) {
    return `p. ${source.chunkPageFrom}`
  }
  return `p. ${source.chunkPageFrom}–${source.chunkPageTo}`
}

export function SourceViewer({ chunkId, documentTitle, messageText, onClose }: Props): JSX.Element {
  const t = useT()
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [chunks, setChunks] = useState<DocumentChunk[]>([])
  const [source, setSource] = useState<ChunkSource | null>(null)

  // PDF previews render off source.chunkPageFrom alone , skip the full-document
  // chunks fetch for them (avoids shipping MBs of unused chunk text over IPC).
  // Non-PDF docs need the chunk list to render the body around the cited
  // chunk, so we fetch sequentially once the documentId is known.
  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setErrorMessage(null)
    setSource(null)
    setChunks([])
    void (async () => {
      try {
        const src = await window.api.documents.getSourceForChunk(chunkId)
        if (cancelled) return
        setSource(src)
        if (src && classifySource(src) !== 'pdf') {
          const all = await window.api.documents.listChunksForDocument(src.documentId)
          if (cancelled) return
          setChunks(all)
        }
        if (!cancelled) setStatus('ready')
      } catch (err: unknown) {
        if (!cancelled) {
          setErrorMessage(err instanceof Error ? err.message : String(err))
          setStatus('error')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [chunkId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const snippets = useMemo(() => {
    if (!messageText || !source) return []
    const fromMarkers = extractCitationSnippets(messageText, {
      documentId: source.documentId,
      chunkId,
    })
    if (fromMarkers.length > 0) return fromMarkers
    // No [doc:X, chunk:Y] markers in the supplied text — used by the quiz path
    // where the explanation is plain prose. Treat the whole message as one
    // snippet so the fuzzy matcher still has something to chew on.
    const stripped = messageText.replace(/\s+/g, ' ').trim()
    return stripped ? [stripped] : []
  }, [messageText, source, chunkId])

  const bodyMode = useMemo(() => classifySource(source), [source])
  const showPdf = bodyMode === 'pdf' && source != null && source.chunkPageFrom != null

  // Highlight cycling: each click on the "N highlights" pill scrolls the next
  // visually-distinct mark group into view. Groups are derived at click time
  // from the live DOM so newly-rendered lazy PDF pages join the rotation
  // automatically. markIdx lives in a ref to keep the click handler stable.
  const asideRef = useRef<HTMLElement | null>(null)
  const markIdxRef = useRef(-1)
  const didInitialFocusRef = useRef(false)
  const [markGroupCount, setMarkGroupCount] = useState(0)
  const cycleHighlights = useCallback(() => {
    const aside = asideRef.current
    if (!aside) return
    const groups = collectMarkGroups(aside)
    if (groups.length === 0) return
    const next = (markIdxRef.current + 1) % groups.length
    markIdxRef.current = next
    focusMarkGroup(aside, groups, next, 'smooth')
  }, [])
  // Reset rotation + initial-focus latch whenever the modal switches to a
  // different chunk.
  useEffect(() => {
    markIdxRef.current = -1
    didInitialFocusRef.current = false
  }, [chunkId])
  // Recount groups whenever marks are added/removed in the modal — PDF pages
  // render lazily so the group set grows as the user scrolls. rAF-debounced
  // because the text layer fires one mutation per span on initial paint.
  // The first time at least one group exists we also snap the viewport to the
  // first highlight so the user lands on the cited phrase , not the top of
  // the page.
  useEffect(() => {
    const aside = asideRef.current
    if (!aside) return
    let raf = 0
    const recompute = (): void => {
      if (raf !== 0) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const groups = collectMarkGroups(aside)
        setMarkGroupCount(groups.length)
        if (!didInitialFocusRef.current && groups.length > 0) {
          didInitialFocusRef.current = true
          markIdxRef.current = 0
          focusMarkGroup(aside, groups, 0, 'auto')
        }
      })
    }
    recompute()
    // Filter mutations to those that actually touch a highlight node ,
    // pdfjs's text layer fires one mutation per span on initial paint and
    // every scroll-driven page render. Without the filter, collectMarkGroups
    // (which calls getBoundingClientRect on every mark) ran on every paint
    // and thrashed layout. We also ignore `is-active`-only flips that come
    // from focusMarkGroup itself (otherwise the observer recurses).
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes') {
          const el = m.target as Element
          if (
            el.classList?.contains?.('pdf-doc__page-mark') ||
            el.classList?.contains?.('source-viewer__mark')
          ) {
            // Skip recompute when only `is-active` toggled — that's our own
            // focusMarkGroup, the mark set didn't change.
            const oldVal = m.oldValue ?? ''
            const newVal = el.getAttribute('class') ?? ''
            const onlyActiveFlip =
              oldVal.replace(/\s*is-active\s*/, ' ').trim() ===
              newVal.replace(/\s*is-active\s*/, ' ').trim()
            if (!onlyActiveFlip) {
              recompute()
              return
            }
          }
          continue
        }
        if (m.type === 'childList') {
          if (nodeListContainsMark(m.addedNodes) || nodeListContainsMark(m.removedNodes)) {
            recompute()
            return
          }
        }
      }
    })
    observer.observe(aside, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
      attributeOldValue: true,
    })
    return () => {
      observer.disconnect()
      if (raf !== 0) cancelAnimationFrame(raf)
    }
  }, [chunkId])

  const headingCrumb =
    source?.headingPath && source.headingPath.length > 0
      ? `§ ${source.headingPath.join(' › ')}`
      : null
  const pageRange = formatPageRange(source)
  const locationLabel = [headingCrumb, pageRange].filter(Boolean).join(' · ') || null

  return (
    <div
      className="source-viewer__backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t('chat.sourceViewer')}
      onMouseDown={(e) => {
        // Close on outside click only — clicks inside the modal shouldn't
        // bubble through, so guard with target === currentTarget.
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <aside
        ref={asideRef}
        className={`source-viewer ${showPdf ? 'source-viewer--pdf' : 'source-viewer--text'}`}
      >
        <header className="source-viewer__header">
          <span className="source-viewer__title">
            {documentTitle ?? source?.title ?? t('chat.chunkFallback', { id: chunkId })}
            {locationLabel ? ` · ${locationLabel}` : ''}
          </span>
          {snippets.length > 0 && (
            <button
              type="button"
              className="source-viewer__highlight-hint"
              title={t('chat.highlightHintTitle', { snippets: snippets.join(' / ') })}
              onClick={cycleHighlights}
              disabled={markGroupCount === 0}
            >
              {(() => {
                // Prefer the live group count — that's what the user actually
                // sees on the page. Fall back to the snippet count for the
                // first frame, before the text layer has painted any marks.
                const count = markGroupCount || snippets.length
                return count === 1 ? t('chat.highlightOne') : t('chat.highlightMany', { count })
              })()}
            </button>
          )}
          <button
            type="button"
            className="chat__header-action"
            onClick={onClose}
            aria-label={t('chat.closeSourceViewer')}
            title={t('chat.closeEsc')}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>
        <div className="source-viewer__body">
          <BodyContents
            status={status}
            errorMessage={errorMessage}
            showPdf={showPdf}
            source={source}
            chunks={chunks}
            chunkId={chunkId}
            snippets={snippets}
            renderMarkdown={bodyMode === 'markdown'}
          />
        </div>
      </aside>
    </div>
  )
}

function BodyContents({
  status,
  errorMessage,
  showPdf,
  source,
  chunks,
  chunkId,
  snippets,
  renderMarkdown,
}: {
  status: LoadStatus
  errorMessage: string | null
  showPdf: boolean
  source: ChunkSource | null
  chunks: DocumentChunk[]
  chunkId: number
  snippets: string[]
  renderMarkdown: boolean
}): JSX.Element {
  const t = useT()
  if (status === 'error' && errorMessage) {
    return <div className="source-viewer__error">{errorMessage}</div>
  }
  if (status === 'loading') {
    return <div className="source-viewer__empty">{t('common.loading')}</div>
  }
  if (showPdf && source && source.chunkPageFrom != null) {
    return (
      <MultiPagePdfPreview
        documentId={source.documentId}
        targetPage={source.chunkPageFrom}
        snippets={snippets}
        citedPageFrom={source.chunkPageFrom}
        citedPageTo={source.chunkPageTo ?? source.chunkPageFrom}
      />
    )
  }
  if (chunks.length === 0) {
    return <div className="source-viewer__empty">{t('chat.noChunks')}</div>
  }
  return (
    <TextDocumentBody
      chunks={chunks}
      targetChunkId={chunkId}
      snippets={snippets}
      renderMarkdown={renderMarkdown}
    />
  )
}

function TextDocumentBody({
  chunks,
  targetChunkId,
  snippets,
  renderMarkdown,
}: {
  chunks: DocumentChunk[]
  targetChunkId: number
  snippets: string[]
  renderMarkdown: boolean
}): JSX.Element {
  const t = useT()
  const targetRef = useRef<HTMLElement | null>(null)

  // Scroll the cited chunk into view on first paint after chunks land. Use a
  // layout effect so we measure once the DOM is in place; useEffect would fire
  // a frame later and show a flash of unscrolled content first.
  useLayoutEffect(() => {
    const el = targetRef.current
    if (!el) return
    // `block: center` puts the cited chunk roughly in the middle of the modal
    // so the user can see what came before AND after without scrolling.
    el.scrollIntoView({ block: 'center', behavior: 'auto' })
  }, [targetChunkId, chunks])

  return (
    <article className="source-viewer__doc" aria-label={t('chat.documentPreview')}>
      {chunks.map((c) => {
        const isTarget = c.id === targetChunkId
        return (
          <section
            key={c.id}
            ref={isTarget ? (targetRef as React.RefObject<HTMLElement>) : undefined}
            className={`source-viewer__doc-section${isTarget ? ' source-viewer__doc-section--cited' : ''}`}
          >
            {isTarget ? (
              <HighlightedText text={c.text} snippets={snippets} />
            ) : renderMarkdown ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{c.text}</ReactMarkdown>
            ) : (
              <pre className="source-viewer__chunk-pre">{c.text}</pre>
            )}
          </section>
        )
      })}
    </article>
  )
}

/** Collects the marked DOM elements inside the modal and groups visually
 *  adjacent ones together so a single click on the "highlights" pill jumps to
 *  the next *region*, not the next individual text-layer span. A mark joins
 *  the previous group when it sits on the same line (vertical overlap with the
 *  previous mark's rect) or on the immediately-following line within roughly
 *  one line height — that catches sentence highlights that wrap across two or
 *  three lines. Cross-page marks always split.
 */
function nodeListContainsMark(list: NodeList): boolean {
  for (let i = 0; i < list.length; i++) {
    const n = list.item(i)
    if (!n || n.nodeType !== 1) continue
    const el = n as Element
    if (
      el.classList?.contains?.('pdf-doc__page-mark') ||
      el.classList?.contains?.('source-viewer__mark') ||
      el.querySelector?.('.pdf-doc__page-mark, .source-viewer__mark')
    ) {
      return true
    }
  }
  return false
}

function collectMarkGroups(root: HTMLElement): HTMLElement[][] {
  const marks = Array.from(
    root.querySelectorAll<HTMLElement>('.pdf-doc__page-mark, .source-viewer__mark'),
  )
  if (marks.length === 0) return []
  const groups: HTMLElement[][] = []
  let currentPage: Element | null = null
  let prevRect: DOMRect | null = null
  for (const m of marks) {
    const rect = m.getBoundingClientRect()
    const page = m.closest('.pdf-doc__page, .source-viewer__doc-section')
    let joinPrev = false
    if (page === currentPage && prevRect !== null) {
      const verticalOverlap =
        Math.min(prevRect.bottom, rect.bottom) - Math.max(prevRect.top, rect.top)
      if (verticalOverlap > 0) {
        // Same line — adjacent words in the same phrase.
        joinPrev = true
      } else {
        // Wrap to the next line: PDF reading order places the next line's
        // marks right after the current line's. Group when the vertical gap
        // is under ~one line height.
        const verticalGap = rect.top - prevRect.bottom
        if (verticalGap >= 0 && verticalGap < rect.height * 0.8) joinPrev = true
      }
    }
    if (joinPrev && groups.length > 0) {
      groups[groups.length - 1]!.push(m)
    } else {
      groups.push([m])
    }
    currentPage = page
    prevRect = rect
  }
  return groups
}

/** Scrolls the first element of `groups[idx]` into view and pulses every mark
 *  in that group via the `is-active` class. Previously-active marks elsewhere
 *  get cleared first so only one group is highlighted at a time. */
function focusMarkGroup(
  root: HTMLElement,
  groups: HTMLElement[][],
  idx: number,
  behavior: ScrollBehavior,
): void {
  const allMarks = root.querySelectorAll<HTMLElement>('.pdf-doc__page-mark, .source-viewer__mark')
  for (const m of allMarks) m.classList.remove('is-active')
  const group = groups[idx]
  if (!group || group.length === 0) return
  for (const m of group) m.classList.add('is-active')
  group[0]!.scrollIntoView({ block: 'center', behavior })
}

function HighlightedText({ text, snippets }: { text: string; snippets: string[] }): JSX.Element {
  const segments = useMemo(() => {
    const ranges = findFuzzyHighlights(text, snippets)
    return applyHighlights(text, ranges)
  }, [text, snippets])
  // Preserve newlines from the source — chunks are extracted at paragraph
  // boundaries; without pre-wrap they'd collapse into one long line.
  return (
    <p className="source-viewer__cited-text">
      {segments.map((seg, i) =>
        seg.highlighted ? (
          <mark key={i} className="source-viewer__mark">
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </p>
  )
}
