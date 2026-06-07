import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { IndexingSection } from './IndexingSection'
import { DEFAULT_SETTINGS } from '@shared/settings'

describe('IndexingSection', () => {
  it('renders the three retrieval sliders', () => {
    render(<IndexingSection settings={DEFAULT_SETTINGS} update={async () => {}} />)
    expect(screen.getByLabelText('Chunk size')).toBeInTheDocument()
    expect(screen.getByLabelText('Chunk overlap')).toBeInTheDocument()
    expect(screen.getByLabelText('Retrieved passages (Top-K)')).toBeInTheDocument()
  })
  it('updates retrieval.topK on slider change', () => {
    const update = vi.fn(async () => {})
    render(<IndexingSection settings={DEFAULT_SETTINGS} update={update} />)
    fireEvent.change(screen.getByLabelText('Retrieved passages (Top-K)'), {
      target: { value: '20' },
    })
    expect(update).toHaveBeenCalledWith({ retrieval: { topK: 20 } })
  })
  it('updates retrieval.chunkSize on slider change', () => {
    const update = vi.fn(async () => {})
    render(<IndexingSection settings={DEFAULT_SETTINGS} update={update} />)
    fireEvent.change(screen.getByLabelText('Chunk size'), { target: { value: '4000' } })
    expect(update).toHaveBeenCalledWith({ retrieval: { chunkSize: 4000 } })
  })
})
