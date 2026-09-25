import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { RerankerSection } from './RerankerSection'

afterEach(() => vi.restoreAllMocks())

describe('Advanced reranker policy', () => {
  it('maps Auto, Always and Off to the same preference fields as System settings', async () => {
    const update = vi.fn(async () => {})
    render(<RerankerSection settings={DEFAULT_SETTINGS} update={update} />)
    const choice = screen.getByRole('combobox', { name: 'Search reranking' })
    expect(choice).toHaveValue('auto')
    for (const [value, enabled, policy] of [
      ['always', true, 'always'],
      ['off', false, 'auto'],
      ['auto', true, 'auto'],
    ] as const) {
      fireEvent.change(choice, { target: { value } })
      await waitFor(() => expect(choice).not.toBeDisabled())
      expect(update).toHaveBeenLastCalledWith({ advanced: { reranker: { enabled, policy } } })
    }
  })

  it('explains when Auto skips the reranker on a small GPU', async () => {
    const info = await window.api.reranker.info()
    vi.spyOn(window.api.reranker, 'info').mockResolvedValue({
      ...info,
      policyDecision: {
        allowed: false,
        mode: 'auto',
        source: 'bundled',
        reason: 'low-vram',
        totalVramGB: 4,
      },
    })
    render(<RerankerSection settings={DEFAULT_SETTINGS} update={async () => {}} />)
    expect(
      await screen.findByText(
        'Skipped automatically on this GPU. Hybrid search remains available.',
      ),
    ).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Search reranking' })).toHaveValue('auto')
  })

  it('keeps the current policy and reports a failed save inline', async () => {
    const update = vi.fn().mockRejectedValue(new Error('Disk full'))
    render(<RerankerSection settings={DEFAULT_SETTINGS} update={update} />)
    const choice = screen.getByRole('combobox', { name: 'Search reranking' })
    fireEvent.change(choice, { target: { value: 'always' } })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Changes could not be saved. Try again.',
    )
    expect(choice).toHaveValue('auto')
    expect(choice).not.toBeDisabled()
  })

  it('warns about Always on small GPUs and retains configured source controls', async () => {
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.advanced.reranker.policy = 'always'
    settings.advanced.ollama.rerankerModel = 'external-reranker'
    const update = vi.fn(async () => {})
    render(<RerankerSection settings={settings} update={update} />)
    expect(
      screen.getByText('Always may add model swaps and longer waits on a small GPU.'),
    ).toBeVisible()
    const external = screen.getByRole('radio', { name: /External.*Ollama/i })
    expect(external).not.toBeDisabled()
    fireEvent.click(external)
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({ advanced: { reranker: { source: 'ollama' } } }),
    )
  })
})
