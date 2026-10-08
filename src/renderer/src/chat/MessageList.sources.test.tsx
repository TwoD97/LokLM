import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { Document } from '@shared/documents'
import { MessageList } from './MessageList'

const locale = vi.hoisted(() => ({ language: 'en' }))
vi.mock('../settings/useSettings', () => ({
  useSettings: () => ({ settings: { basic: { language: locale.language } } }),
}))

describe('generation metrics', () => {
  function renderMetrics(tokenCount: number, tokensPerSec: number | null) {
    locale.language = 'en'
    return render(
      <MessageList
        messages={[
          {
            id: 'answer',
            role: 'assistant',
            content: 'The recorded amount is 42.',
            streaming: false,
            metrics: { ttftMs: 1200, tokenCount, tokensPerSec },
          },
        ]}
        documents={[]}
        keepPipelineVisible={false}
        onCopy={vi.fn()}
        onCitationClick={vi.fn()}
      />,
    )
  }

  it('keeps first-visible latency without presenting an unavailable count as zero tokens', () => {
    const view = renderMetrics(0, null)
    expect(view.container.querySelector('.chat__metrics')).toHaveTextContent(/^TTFT 1\.20 s$/)
  })

  it('retains measured positive token counts and throughput', () => {
    const view = renderMetrics(42, 12.5)
    expect(view.container.querySelector('.chat__metrics')).toHaveTextContent(
      'TTFT 1.20 s · 12.5 tok/s · 42 tok',
    )
  })
})

describe('source navigation labels', () => {
  it.each([
    ['en', 'No inline marker.', 'Provided sources · 1'],
    ['de', 'Keine Quellenmarkierung.', 'Quellen im Kontext · 1'],
    ['en', 'Claim [doc:1, chunk:11].', '1 cited source'],
    ['de', 'Aussage [doc:1, chunk:11].', '1 zitierte Quelle'],
    ['en', 'Example `[doc:1, chunk:11]`.', 'Provided sources · 1'],
  ])('distinguishes supplied context from prose citations in %s', (language, content, label) => {
    locale.language = language!
    render(
      <MessageList
        messages={[
          {
            id: 'answer',
            role: 'assistant',
            content: content!,
            streaming: false,
            citations: [{ documentId: 1, chunkId: 11 }],
          },
        ]}
        documents={[]}
        keepPipelineVisible={false}
        onCopy={vi.fn()}
        onCitationClick={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: label })).toBeVisible()
  })
})

describe('source menu keyboard navigation', () => {
  const content = 'Compare [doc:2, chunk:21] with [doc:1, chunk:11] and [doc:2, chunk:22].'
  const documents: Document[] = [
    {
      id: 1,
      workspaceId: 1,
      title: 'Approval memo',
      sourcePath: '/approval.md',
      mimeType: 'text/markdown',
      byteSize: 100,
      status: 'ready',
      chunkCount: 1,
      tokenCount: 20,
      addedAt: 1,
      pinned: false,
    },
    {
      id: 2,
      workspaceId: 1,
      title: 'Revised memo',
      sourcePath: '/revised.md',
      mimeType: 'text/markdown',
      byteSize: 120,
      status: 'ready',
      chunkCount: 2,
      tokenCount: 25,
      addedAt: 1,
      pinned: false,
    },
  ]

  function setup(onCitationClick = vi.fn()) {
    locale.language = 'en'
    render(
      <>
        <button type="button">Before answer</button>
        <MessageList
          messages={[
            {
              id: 'answer',
              role: 'assistant',
              content,
              streaming: false,
              citations: [
                { documentId: 2, chunkId: 21 },
                { documentId: 1, chunkId: 11 },
                { documentId: 2, chunkId: 22 },
              ],
            },
          ]}
          documents={documents}
          keepPipelineVisible={false}
          onCopy={vi.fn()}
          onCitationClick={onCitationClick}
        />
        <button type="button">After answer</button>
      </>,
    )
    return { trigger: screen.getByRole('button', { name: '2 cited sources' }), onCitationClick }
  }

  it('names the menu and supports arrow wrapping, Home/End, and Escape focus restoration', () => {
    const { trigger } = setup()
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const menu = screen.getByRole('menu', { name: '2 cited sources' })
    const items = within(menu).getAllByRole('menuitem')
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-controls', menu.id)
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent('Revised memo')
    expect(items[0]).toHaveFocus()
    expect(items.every((item) => item.tabIndex === -1)).toBe(true)
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    expect(items[2]).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(items[0]).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(items[2]).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'Home' })
    expect(items[0]).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens the last source with ArrowUp and gives the source viewer focus ownership on selection', () => {
    const onCitationClick = vi.fn(() =>
      screen.getByRole('button', { name: 'After answer' }).focus(),
    )
    const { trigger } = setup(onCitationClick)
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowUp' })
    const last = screen.getByRole('menuitem', { name: '3 Revised memo' })
    expect(last).toHaveFocus()
    fireEvent.click(last)
    expect(onCitationClick).toHaveBeenCalledExactlyOnceWith({
      documentId: 2,
      chunkId: 22,
      messageText: content,
    })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'After answer' })).toHaveFocus()
  })

  it.each([false, true])(
    'lets Tab leave the menu without trapping focus (shift=%s)',
    (shiftKey) => {
      const { trigger } = setup()
      fireEvent.click(trigger)
      const accepted = fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey })
      expect(accepted).toBe(true) // Native Tab navigation must not be prevented.
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(trigger).toHaveFocus() // Browser navigation continues from this anchor.
    },
  )

  it('dismisses on outside pointer or focus without returning focus to the source button', () => {
    const { trigger } = setup()
    const outside = screen.getByRole('button', { name: 'After answer' })
    fireEvent.click(trigger)
    act(() => outside.focus())
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(outside).toHaveFocus()
    fireEvent.click(trigger)
    fireEvent.mouseDown(outside)
    act(() => outside.focus())
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(outside).toHaveFocus()
  })
})

describe('finished preparation status', () => {
  it.each([
    ['en', 'Incomplete'],
    ['de', 'Nicht abgeschlossen'],
  ])('shows interrupted work neutrally in %s', (language, label) => {
    locale.language = language!
    const view = render(
      <MessageList
        messages={[
          {
            id: 'answer',
            role: 'assistant',
            content: 'Partial answer. Response interrupted.',
            streaming: false,
            pipeline: [{ stage: 'retrieve', status: 'running' }],
          },
        ]}
        documents={[]}
        keepPipelineVisible={true}
        onCopy={vi.fn()}
        onCitationClick={vi.fn()}
      />,
    )
    expect(screen.getByText(label!)).toBeVisible()
    expect(view.container.querySelector('.chat__pipeline-check')).toBeNull()
    fireEvent.click(view.container.querySelector('.chat__pipeline-toggle')!)
    expect(view.container.querySelector('.chat__pipeline-row--running')).toBeNull()
  })

  it('keeps completed preparation marked done when generation later failed', () => {
    locale.language = 'en'
    const view = render(
      <MessageList
        messages={[
          {
            id: 'answer',
            role: 'assistant',
            content: 'Partial answer. Response interrupted.',
            streaming: false,
            pipeline: [{ stage: 'retrieve', status: 'done', durationMs: 100 }],
          },
        ]}
        documents={[]}
        keepPipelineVisible={true}
        onCopy={vi.fn()}
        onCitationClick={vi.fn()}
      />,
    )
    expect(view.container.querySelector('.chat__pipeline-check')).not.toBeNull()
    expect(view.container.querySelector('.chat__pipeline-summary')).toHaveTextContent('Done')
    expect(screen.queryByText('Incomplete')).toBeNull()
  })
})

describe('source menu passage identity', () => {
  const documents = [
    { id: 1, title: 'Approval memo', sourcePath: '/approval.md' },
    { id: 2, title: 'Revised memo', sourcePath: '/revised.md' },
    { id: 3, title: 'Unused memo', sourcePath: '/unused.md' },
  ] as Document[]
  // Intentionally different from mention order; no UI number may come from it.
  const citations = [
    { documentId: 2, chunkId: 21 },
    { documentId: 1, chunkId: 12 },
    { documentId: 1, chunkId: 11 },
    { documentId: 3, chunkId: 31 },
  ]

  function setup(content: string) {
    locale.language = 'en'
    const onCitationClick = vi.fn()
    const view = render(
      <MessageList
        messages={[{ id: 'answer', role: 'assistant', content, streaming: false, citations }]}
        documents={documents}
        keepPipelineVisible={false}
        onCopy={vi.fn()}
        onCitationClick={onCitationClick}
      />,
    )
    return { ...view, onCitationClick }
  }

  it('uses the same passage for inline and menu numbers, including a second passage in one document', () => {
    const content =
      'First [doc:1, chunk:11], second [doc:1, chunk:12], other [doc:2, chunk:21], first again [doc:1, chunk:11].'
    const { container, onCitationClick } = setup(content)
    const chips = Array.from(container.querySelectorAll<HTMLAnchorElement>('.citation-chip'))
    expect(chips.map((chip) => chip.textContent)).toEqual(['1', '2', '3', '1'])
    const targets = [
      { documentId: 1, chunkId: 11 },
      { documentId: 1, chunkId: 12 },
      { documentId: 2, chunkId: 21 },
    ]
    const names = ['1 Approval memo', '2 Approval memo', '3 Revised memo']
    for (const [index, target] of targets.entries()) {
      fireEvent.click(chips[index]!)
      expect(onCitationClick).toHaveBeenLastCalledWith({ ...target, messageText: content })
      fireEvent.click(screen.getByRole('button', { name: '2 cited sources' }))
      const menu = screen.getByRole('menu')
      const rows = within(menu).getAllByRole('menuitem')
      expect(rows).toHaveLength(names.length)
      rows.forEach((row, rowIndex) => expect(row).toHaveAccessibleName(names[rowIndex]!))
      fireEvent.click(within(menu).getByRole('menuitem', { name: names[index]! }))
      expect(onCitationClick).toHaveBeenLastCalledWith({ ...target, messageText: content })
    }
    expect(onCitationClick).toHaveBeenCalledTimes(6)
  })

  it('does not let literal or unknown markers consume a menu number or add a source', () => {
    const content =
      'Literal `[doc:3, chunk:31]`; unknown [doc:99, chunk:99]; actual [doc:1, chunk:12].'
    const { container, onCitationClick } = setup(content)
    expect(container.querySelectorAll('.citation-chip')).toHaveLength(1)
    expect(container.querySelector('.citation-chip')).toHaveTextContent('1')
    fireEvent.click(screen.getByRole('button', { name: '1 cited source' }))
    expect(screen.getAllByRole('menuitem')).toHaveLength(1)
    fireEvent.click(screen.getByRole('menuitem', { name: '1 Approval memo' }))
    expect(onCitationClick).toHaveBeenCalledExactlyOnceWith({
      documentId: 1,
      chunkId: 12,
      messageText: content,
    })
  })

  it('keeps provided-source grouping and representative passage access when no active citation exists', () => {
    const content = 'No citation; the example `[doc:1, chunk:11]` remains literal.'
    const { container, onCitationClick } = setup(content)
    expect(container.querySelectorAll('.citation-chip')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Provided sources · 3' }))
    const rows = screen.getAllByRole('menuitem')
    expect(rows).toHaveLength(3)
    const names = ['1 Revised memo', '2 Approval memo', '3 Unused memo']
    rows.forEach((row, index) => expect(row).toHaveAccessibleName(names[index]!))
    fireEvent.click(screen.getByRole('menuitem', { name: '2 Approval memo' }))
    expect(onCitationClick).toHaveBeenCalledExactlyOnceWith({
      documentId: 1,
      chunkId: 12,
      messageText: content,
    })
  })
})
