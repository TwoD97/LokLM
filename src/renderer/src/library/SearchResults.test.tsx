import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { LibrarySearchHit } from '@shared/documents'
import { SearchResults } from './SearchResults'

function hit(overrides: Partial<LibrarySearchHit> = {}): LibrarySearchHit {
  return {
    chunkId: 1,
    documentId: 1,
    documentTitle: 'Doc.pdf',
    docType: 'pdf',
    pageFrom: null,
    pageTo: null,
    headingPath: null,
    score: 1,
    addedAt: 1000,
    byteSize: 1234,
    language: 'en',
    segments: [{ text: 'plain excerpt', highlighted: false }],
    ...overrides,
  }
}

describe('SearchResults', () => {
  it('renders one row per hit with its document title', () => {
    render(
      <SearchResults
        status="done"
        hits={[hit({ documentTitle: 'Alpha.pdf' }), hit({ chunkId: 2, documentTitle: 'Beta.md' })]}
        onOpen={() => {}}
      />,
    )
    expect(screen.getByText('Alpha.pdf')).toBeTruthy()
    expect(screen.getByText('Beta.md')).toBeTruthy()
  })

  it('renders highlighted segments inside <mark> and plain segments as text', () => {
    render(
      <SearchResults
        status="done"
        hits={[
          hit({
            segments: [
              { text: 'before ', highlighted: false },
              { text: 'match', highlighted: true },
              { text: ' after', highlighted: false },
            ],
          }),
        ]}
        onOpen={() => {}}
      />,
    )
    const marked = screen.getByText('match')
    expect(marked.tagName).toBe('MARK')
    expect(screen.getByText(/before/)).toBeTruthy()
  })

  it('shows a page label when the chunk has a page number', () => {
    render(
      <SearchResults status="done" hits={[hit({ pageFrom: 3, pageTo: 3 })]} onOpen={() => {}} />,
    )
    expect(screen.getByText('p. 3')).toBeTruthy()
  })

  it('shows a page range when from and to differ', () => {
    render(
      <SearchResults status="done" hits={[hit({ pageFrom: 3, pageTo: 5 })]} onOpen={() => {}} />,
    )
    expect(screen.getByText('p. 3–5')).toBeTruthy()
  })

  it('falls back to a heading breadcrumb when there is no page number', () => {
    render(
      <SearchResults
        status="done"
        hits={[hit({ pageFrom: null, headingPath: ['Intro', 'Why Markdown'] })]}
        onOpen={() => {}}
      />,
    )
    expect(screen.getByText(/Intro\s*›\s*Why Markdown/)).toBeTruthy()
  })

  it('calls onOpen with the hit when a row is clicked', () => {
    const onOpen = vi.fn()
    const h = hit({ chunkId: 42, documentTitle: 'Click.pdf' })
    render(<SearchResults status="done" hits={[h]} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: /Click\.pdf/ }))
    expect(onOpen).toHaveBeenCalledWith(h)
  })

  it('shows the empty state only after a completed search with no hits', () => {
    const { rerender } = render(<SearchResults status="searching" hits={[]} onOpen={() => {}} />)
    expect(screen.queryByText('No documents match your search.')).toBeNull()
    rerender(<SearchResults status="done" hits={[]} onOpen={() => {}} />)
    expect(screen.getByText('No documents match your search.')).toBeTruthy()
  })
})
