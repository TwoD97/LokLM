import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { App } from './App'

describe('App (smoke)', () => {
  it('renders the LokLM heading', () => {
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: 'LokLM' })).toBeInTheDocument()
  })

  it('renders the IPC-Probe section', () => {
    render(<App />)
    expect(screen.getByRole('heading', { level: 2, name: 'IPC-Probe' })).toBeInTheDocument()
  })
})
