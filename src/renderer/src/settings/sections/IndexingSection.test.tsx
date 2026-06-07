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
  it('updates retrieval.topK on slider release', () => {
    const update = vi.fn(async () => {})
    render(<IndexingSection settings={DEFAULT_SETTINGS} update={update} />)
    const slider = screen.getByLabelText('Retrieved passages (Top-K)')
    fireEvent.change(slider, { target: { value: '20' } })
    fireEvent.blur(slider)
    expect(update).toHaveBeenCalledWith({ retrieval: { topK: 20 } })
  })
  it('updates retrieval.chunkSize on slider release', () => {
    const update = vi.fn(async () => {})
    render(<IndexingSection settings={DEFAULT_SETTINGS} update={update} />)
    const slider = screen.getByLabelText('Chunk size')
    fireEvent.change(slider, { target: { value: '4000' } })
    fireEvent.blur(slider)
    expect(update).toHaveBeenCalledWith({ retrieval: { chunkSize: 4000 } })
  })
})
