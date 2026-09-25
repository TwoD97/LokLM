import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { WriteResult } from '@shared/writing'
import { WritingView } from './WritingView'

afterEach(() => vi.restoreAllMocks())

describe('Writing workflow', () => {
  it('keeps source and mode fixed during the request, then invalidates a result when edited', async () => {
    let finish!: (value: WriteResult) => void
    vi.spyOn(window.api.writing, 'improve').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    render(<WritingView />)
    const source = screen.getByRole('textbox', { name: 'Your text' })
    fireEvent.change(source, { target: { value: 'Original text' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rewrite' }))
    expect(source).toHaveAttribute('readonly')
    expect(screen.getByRole('tab', { name: 'Formal' })).toBeDisabled()
    await act(async () => finish({ text: 'Improved text', mode: 'improve', detected: 'en' }))
    expect(screen.getByText('Improved text')).toBeVisible()
    expect(source).not.toHaveAttribute('readonly')
    fireEvent.change(source, { target: { value: 'Different text' } })
    expect(screen.queryByText('Improved text')).not.toBeInTheDocument()
  })

  it('retains a successful result if a repeat request fails', async () => {
    vi.spyOn(window.api.writing, 'improve')
      .mockResolvedValueOnce({ text: 'Kept result', mode: 'improve', detected: 'en' })
      .mockRejectedValueOnce(new Error('model failed'))
    render(<WritingView />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Original' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rewrite' }))
    await screen.findByText('Kept result')
    fireEvent.click(screen.getByRole('button', { name: 'Rewrite' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('model failed')
    expect(screen.getByText('Kept result')).toBeVisible()
  })
})
