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
  }
  return {
    query: '',
    onQueryChange: vi.fn(),
    onClear: vi.fn(),
    filters,
    onTypesChange: vi.fn(),
    onDateChange: vi.fn(),
    onSizeChange: vi.fn(),
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
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'filename' } })
    expect(p.onSortChange).toHaveBeenCalledWith('filename')
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '30d' } })
    expect(p.onDateChange).toHaveBeenCalledWith('30d')
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: 'large' } })
    expect(p.onSizeChange).toHaveBeenCalledWith('large')
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
