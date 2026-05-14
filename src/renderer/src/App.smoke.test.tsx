import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
      expect(screen.getByRole('heading', { level: 1, name: 'Konto anlegen' })).toBeInTheDocument()
    })
  })

  it('enables registration only after valid input', async () => {
    render(<App />)

    const submit = await screen.findByRole('button', { name: 'Konto anlegen' })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/Anzeigename/), { target: { value: 'Test User' } })

    const passwordInputs = screen.getAllByLabelText(/Passwort/)
    fireEvent.change(passwordInputs[0]!, { target: { value: 'CorrectHorse42!' } })
    fireEvent.change(passwordInputs[1]!, { target: { value: 'CorrectHorse42!' } })

    expect(submit).toBeEnabled()
  })
})
