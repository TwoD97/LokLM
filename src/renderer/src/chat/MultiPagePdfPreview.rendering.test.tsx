import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect, useRef, useState } from 'react'
import { MultiPagePdfPreview } from './MultiPagePdfPreview'

const { getDocument, createTextLayer } = vi.hoisted(() => ({
  getDocument: vi.fn(),
  createTextLayer: vi.fn(),
}))
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument,
  TextLayer: function (options: unknown) {
    return createTextLayer(options)
  },
}))

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

const firstSnippet = 'The turbine maintenance interval is fourteen days'
const secondSnippet = 'The warehouse opening schedule changes every winter'
const bytes = new Uint8Array([1])
const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
type TextJob = ReturnType<typeof deferred> & {
  cancel: ReturnType<typeof vi.fn>
  deliverQueuedText: () => void
}
let textJobs: TextJob[]
let delayText: boolean

function documentTask(pageCount = 1) {
  const activeCanvases = new Set<HTMLCanvasElement>()
  const pages = Array.from({ length: pageCount }, () => {
    const jobs: Array<ReturnType<typeof deferred> & { cancel: ReturnType<typeof vi.fn> }> = []
    return {
      jobs,
      cleanup: vi.fn(),
      getViewport: ({ scale }: { scale: number }) => ({
        width: 600 * scale,
        height: 800 * scale,
        scale,
      }),
      streamTextContent: vi.fn(() => [firstSnippet, secondSnippet]),
      render: vi.fn(({ canvas }: { canvas: HTMLCanvasElement }) => {
        if (activeCanvases.has(canvas)) {
          return {
            promise: Promise.reject(
              new Error('Cannot use the same canvas during multiple renders'),
            ),
            cancel: vi.fn(),
          }
        }
        activeCanvases.add(canvas)
        const pending = deferred()
        const cancel = vi.fn(() => {
          activeCanvases.delete(canvas)
          pending.reject(new Error('Rendering cancelled'))
        })
        const promise = pending.promise.then(
          () => {
            activeCanvases.delete(canvas)
          },
          (error: unknown) => {
            activeCanvases.delete(canvas)
            throw error
          },
        )
        jobs.push({ ...pending, cancel })
        return { promise, cancel }
      }),
    }
  })
  const doc = { numPages: pageCount, getPage: vi.fn(async (number: number) => pages[number - 1]) }
  const task = { promise: Promise.resolve(doc), destroy: vi.fn().mockResolvedValue(undefined) }
  getDocument.mockReturnValue(task)
  return { pages, task }
}

beforeEach(() => {
  getDocument.mockReset()
  createTextLayer.mockReset()
  textJobs = []
  delayText = false
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    {} as CanvasRenderingContext2D,
  )
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        this.callback(
          [{ target, isIntersecting: true } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        )
      }
      unobserve() {}
      disconnect() {}
    },
  )
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  createTextLayer.mockImplementation(
    ({ container, textContentSource }: { container: HTMLElement; textContentSource: string[] }) => {
      const pending = deferred()
      const textDivs: HTMLElement[] = []
      const cancel = vi.fn(() => pending.reject(new Error('Text layer cancelled')))
      // PDF.js can already have a fulfilled reader callback queued when cancel
      // rejects its capability. That callback still owns this captured node.
      const deliverQueuedText = () => {
        for (const text of textContentSource) {
          const span = document.createElement('span')
          span.textContent = text
          container.append(span)
          textDivs.push(span)
        }
      }
      textJobs.push({ ...pending, cancel, deliverQueuedText })
      if (!delayText) pending.resolve()
      return {
        cancel,
        textDivs,
        textContentItemsStr: textContentSource,
        render: () => pending.promise.then(deliverQueuedText),
      }
    },
  )
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (originalScrollIntoView)
    Object.defineProperty(Element.prototype, 'scrollIntoView', originalScrollIntoView)
  else Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
})

describe('PDF page rendering ownership', () => {
  it('keeps a neighboring raster task when newly added highlights rerender the parent', async () => {
    const { pages } = documentTask(2)
    const snippets = [firstSnippet]
    function HighlightCounter() {
      const root = useRef<HTMLDivElement>(null)
      const [count, setCount] = useState(0)
      useEffect(() => {
        const observer = new MutationObserver(() => {
          setCount(root.current?.querySelectorAll('.pdf-doc__page-mark').length ?? 0)
        })
        observer.observe(root.current!, { subtree: true, childList: true, attributes: true })
        return () => observer.disconnect()
      }, [])
      return (
        <div ref={root} data-highlight-count={count}>
          <MultiPagePdfPreview bytes={bytes} targetPage={1} snippets={snippets} />
        </div>
      )
    }
    const view = render(<HighlightCounter />)
    await waitFor(() => expect(pages[1]!.render).toHaveBeenCalledOnce())
    await act(async () => pages[0]!.jobs[0]!.resolve())
    await waitFor(() =>
      expect(view.container.firstChild).toHaveAttribute('data-highlight-count', '1'),
    )
    expect(pages[1]!.render).toHaveBeenCalledOnce()
    expect(pages[1]!.jobs[0]!.cancel).not.toHaveBeenCalled()
    await act(async () => pages[1]!.jobs[0]!.resolve())
    expect(view.container.querySelector('[data-page="2"] canvas')).not.toHaveClass('is-hidden')
  })

  it('cancels the owned raster task when the preview closes', async () => {
    const { pages } = documentTask()
    const view = render(<MultiPagePdfPreview bytes={bytes} targetPage={1} />)
    await waitFor(() => expect(pages[0]!.render).toHaveBeenCalledOnce())
    const cleanups = pages[0]!.cleanup.mock.calls.length
    view.unmount()
    expect(pages[0]!.jobs[0]!.cancel).toHaveBeenCalledOnce()
    expect(pages[0]!.cleanup).toHaveBeenCalledTimes(cleanups)
    await act(async () => undefined)
    expect(pages[0]!.cleanup).toHaveBeenCalledTimes(cleanups + 1)
  })

  it('uses the latest snippets after a pending canvas finishes without restarting it', async () => {
    const { pages } = documentTask()
    const view = render(
      <MultiPagePdfPreview bytes={bytes} targetPage={1} snippets={[firstSnippet]} />,
    )
    await waitFor(() => expect(pages[0]!.render).toHaveBeenCalledOnce())
    view.rerender(<MultiPagePdfPreview bytes={bytes} targetPage={1} snippets={[secondSnippet]} />)
    expect(pages[0]!.render).toHaveBeenCalledOnce()
    expect(pages[0]!.jobs[0]!.cancel).not.toHaveBeenCalled()
    await act(async () => pages[0]!.jobs[0]!.resolve())
    await waitFor(() =>
      expect(view.container.querySelector('.pdf-doc__page-mark')).toHaveTextContent(secondSnippet),
    )
    expect(pages[0]!.render).toHaveBeenCalledOnce()
  })

  it('refreshes and removes highlights without repainting a completed canvas', async () => {
    const { pages } = documentTask()
    const view = render(
      <MultiPagePdfPreview bytes={bytes} targetPage={1} snippets={[firstSnippet]} />,
    )
    await waitFor(() => expect(pages[0]!.render).toHaveBeenCalledOnce())
    await act(async () => pages[0]!.jobs[0]!.resolve())
    await waitFor(() =>
      expect(view.container.querySelector('.pdf-doc__page-mark')).toHaveTextContent(firstSnippet),
    )
    view.rerender(<MultiPagePdfPreview bytes={bytes} targetPage={1} snippets={[secondSnippet]} />)
    await waitFor(() =>
      expect(view.container.querySelector('.pdf-doc__page-mark')).toHaveTextContent(secondSnippet),
    )
    expect(pages[0]!.render).toHaveBeenCalledOnce()
    view.rerender(<MultiPagePdfPreview bytes={bytes} targetPage={1} snippets={[]} />)
    expect(view.container.querySelector('.pdf-doc__page-mark')).toBeNull()
    expect(view.container.querySelector('.pdf-doc__text-layer-host')).toBeEmptyDOMElement()
    expect(pages[0]!.render).toHaveBeenCalledOnce()
    expect(view.container.querySelector('canvas')).not.toHaveClass('is-hidden')
  })

  it('cancels a stale text layer and prevents it from overwriting the current highlights', async () => {
    delayText = true
    const { pages } = documentTask()
    const view = render(
      <MultiPagePdfPreview bytes={bytes} targetPage={1} snippets={[firstSnippet]} />,
    )
    await waitFor(() => expect(pages[0]!.render).toHaveBeenCalledOnce())
    await act(async () => pages[0]!.jobs[0]!.resolve())
    await waitFor(() => expect(textJobs).toHaveLength(1))
    view.rerender(<MultiPagePdfPreview bytes={bytes} targetPage={1} snippets={[secondSnippet]} />)
    await waitFor(() => expect(textJobs).toHaveLength(2))
    expect(textJobs[0]!.cancel).toHaveBeenCalledOnce()
    await act(async () => {
      textJobs[1]!.resolve()
      textJobs[0]!.resolve()
    })
    expect(view.container.querySelectorAll('.pdf-doc__page-mark')).toHaveLength(1)
    expect(view.container.querySelector('.pdf-doc__page-mark')).toHaveTextContent(secondSnippet)
    expect(pages[0]!.render).toHaveBeenCalledOnce()
  })

  it('cancels the owned text task when the preview closes', async () => {
    delayText = true
    const { pages } = documentTask()
    const view = render(
      <MultiPagePdfPreview bytes={bytes} targetPage={1} snippets={[firstSnippet]} />,
    )
    await waitFor(() => expect(pages[0]!.render).toHaveBeenCalledOnce())
    await act(async () => pages[0]!.jobs[0]!.resolve())
    await waitFor(() => expect(textJobs).toHaveLength(1))
    const layer = view.container.querySelector('.pdf-doc__text-layer')!
    const cleanups = pages[0]!.cleanup.mock.calls.length
    view.unmount()
    expect(textJobs[0]!.cancel).toHaveBeenCalledOnce()
    expect(pages[0]!.cleanup).toHaveBeenCalledTimes(cleanups)
    await act(async () => textJobs[0]!.resolve())
    expect(layer).toBeEmptyDOMElement()
    expect(pages[0]!.cleanup.mock.calls.length).toBeGreaterThan(cleanups)
  })

  it("isolates a cancelled text layer's queued DOM write from its replacement", async () => {
    delayText = true
    const { pages } = documentTask()
    const view = render(
      <MultiPagePdfPreview bytes={bytes} targetPage={1} snippets={[firstSnippet]} />,
    )
    await waitFor(() => expect(pages[0]!.render).toHaveBeenCalledOnce())
    await act(async () => pages[0]!.jobs[0]!.resolve())
    await waitFor(() => expect(textJobs).toHaveLength(1))
    // Capture the already-fulfilled reader's delivery before cancelling it.
    const queuedDelivery = textJobs[0]!.deliverQueuedText
    view.rerender(<MultiPagePdfPreview bytes={bytes} targetPage={1} snippets={[secondSnippet]} />)
    await waitFor(() => expect(textJobs).toHaveLength(2))
    expect(textJobs[0]!.cancel).toHaveBeenCalledOnce()
    await act(async () => textJobs[1]!.resolve())
    expect(view.container.querySelector('.pdf-doc__page-mark')).toHaveTextContent(secondSnippet)
    act(() => queuedDelivery())
    expect(view.container.querySelectorAll('.pdf-doc__text-layer span')).toHaveLength(2)
    expect(view.container.querySelectorAll('.pdf-doc__page-mark')).toHaveLength(1)
    expect(view.container.querySelector('.pdf-doc__page-mark')).toHaveTextContent(secondSnippet)
    expect(pages[0]!.render).toHaveBeenCalledOnce()
    const currentQueuedDelivery = textJobs[1]!.deliverQueuedText
    view.rerender(<MultiPagePdfPreview bytes={bytes} targetPage={1} snippets={[]} />)
    act(() => currentQueuedDelivery())
    expect(view.container.querySelector('.pdf-doc__text-layer-host')).toBeEmptyDOMElement()
  })
})
