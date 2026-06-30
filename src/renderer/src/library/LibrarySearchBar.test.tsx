import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { LibraryDocType } from '@shared/documents'
import { LibrarySearchBar } from './LibrarySearchBar'
import type { LibrarySearchFilters } from './useLibrarySearch'

function defaults() {
  const filters: LibrarySearchFilters = {
    types: new Set<LibraryDocType>(),
    date: 'any',
    size: 'any',
    status: 'all',
  }
  return {
    query: '',
    onQueryChange: vi.fn(),
    onClear: vi.fn(),
    filters,
    onTypesChange: vi.fn(),
    onDateChange: vi.fn(),
    onSizeChange: vi.fn(),
    onStatusChange: vi.fn(),
    sort: 'relevance' as const,
    onSortChange: vi.fn(),
    active: false,
  }
}

describe('LibrarySearchBar', () => {
  it('reports typing through onQueryChange', () => {
    const p = defaults()
    render(<LibrarySearchBar {...p} />)
    fireEvent.change(screen.getByPlaceholderText('Search documents…'), {
      target: { value: 'invoice' },
    })
    expect(p.onQueryChange).toHaveBeenCalledWith('invoice')
  })

  it('toggles a type bucket on when its chip is clicked', () => {
    const p = defaults()
    render(<LibrarySearchBar {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }))
    expect(p.onTypesChange).toHaveBeenCalledWith(new Set(['pdf']))
  })

  it('toggles a type bucket off when it was already selected', () => {
    const p = defaults()
    p.filters.types = new Set<LibraryDocType>(['pdf', 'md'])
    render(<LibrarySearchBar {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }))
    expect(p.onTypesChange).toHaveBeenCalledWith(new Set(['md']))
  })

  it('reports sort, date and size changes', () => {
    const p = defaults()
    render(<LibrarySearchBar {...p} />)
    // The dropdowns are now custom listboxes (ui/Select): open the trigger, then
    // click the option. Each pick closes its menu, so only one is open at a time.
    fireEvent.click(screen.getByRole('button', { name: 'Sort' }))
    fireEvent.click(screen.getByRole('option', { name: 'Filename' }))
    expect(p.onSortChange).toHaveBeenCalledWith('filename')

    fireEvent.click(screen.getByRole('button', { name: 'Date' }))
    fireEvent.click(screen.getByRole('option', { name: 'Last 30 days' }))
    expect(p.onDateChange).toHaveBeenCalledWith('30d')

    fireEvent.click(screen.getByRole('button', { name: 'Size' }))
    fireEvent.click(screen.getByRole('option', { name: '> 10 MB' }))
    expect(p.onSizeChange).toHaveBeenCalledWith('large')
  })

  it('reports a status filter change while browsing', () => {
    const p = defaults()
    render(<LibrarySearchBar {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Status' }))
    fireEvent.click(screen.getByRole('option', { name: 'Indexing' }))
    expect(p.onStatusChange).toHaveBeenCalledWith('indexing')
  })

  it('hides the status filter while a search query is active', () => {
    const p = defaults()
    const { rerender } = render(<LibrarySearchBar {...p} />)
    expect(screen.getByRole('button', { name: 'Status' })).toBeTruthy()
    // Status has no meaning over search hits, so it drops out in search mode.
    rerender(<LibrarySearchBar {...p} query="foo" active />)
    expect(screen.queryByRole('button', { name: 'Status' })).toBeNull()
  })

  it('shows a clear button only when there is a query', () => {
    const p = defaults()
    const { rerender } = render(<LibrarySearchBar {...p} />)
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
    rerender(<LibrarySearchBar {...p} query="foo" active />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(p.onClear).toHaveBeenCalled()
  })
})
