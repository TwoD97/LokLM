import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { AdvancedTab } from './AdvancedTab'

describe('Advanced settings navigation', () => {
  it('moves focus and selection with arrows, Home and End and labels each panel', async () => {
    const outside = vi.fn()
    render(
      <div onKeyDown={outside}>
        <AdvancedTab />
      </div>,
    )
    const first = await screen.findByRole('tab', { name: 'LLM' })
    first.focus()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.filter((tab) => tab.tabIndex === 0)).toEqual([first])
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    const retrieval = screen.getByRole('tab', { name: 'Retrieval' })
    expect(retrieval).toHaveFocus()
    expect(retrieval).toHaveAttribute('aria-selected', 'true')
    const panel = screen.getByRole('tabpanel', { name: 'Retrieval' })
    expect(retrieval).toHaveAttribute('aria-controls', panel.id)
    expect(panel).toHaveAttribute('aria-labelledby', retrieval.id)
    expect(outside).not.toHaveBeenCalled()
    fireEvent.keyDown(retrieval, { key: 'End' })
    const last = screen.getByRole('tab', { name: 'Diagnostics' })
    expect(last).toHaveFocus()
    fireEvent.keyDown(last, { key: 'ArrowRight' })
    expect(first).toHaveFocus()
    fireEvent.keyDown(first, { key: 'ArrowLeft' })
    expect(last).toHaveFocus()
    fireEvent.keyDown(last, { key: 'Home' })
    expect(first).toHaveFocus()
    for (const tab of tabs) {
      expect(document.getElementById(tab.getAttribute('aria-controls')!)).toBeInTheDocument()
    }
  })
})
