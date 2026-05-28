import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { App } from './App'

describe('App (smoke)', () => {
  it('renders the LokLM brand', () => {
    render(<App />)
    // brand shows up in both the titlebar and the in-content header.
    expect(screen.getAllByText('LokLM').length).toBeGreaterThan(0)
  })

  it('shows the register view when no user is registered', async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /create account/i })).toBeInTheDocument()
    })
  })
})
