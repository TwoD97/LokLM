import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/settings'
import type { ModelStatus, RerankerStatus } from '@shared/documents'
import { refreshSettings } from '../settings/useSettings'
import { WarmingView } from './WarmingView'

beforeEach(async () => {
  vi.spyOn(window.api.settings, 'get').mockResolvedValue({
    ...DEFAULT_SETTINGS,
    basic: { ...DEFAULT_SETTINGS.basic, language: 'en' },
  })
  await act(() => refreshSettings())
  const llm = await window.api.llm.status()
  const embedder = await window.api.embedder.status()
  vi.spyOn(window.api.llm, 'status').mockResolvedValue({
    ...llm,
    state: 'loading',
    loadProgress: 0.42,
  })
  vi.spyOn(window.api.embedder, 'status').mockResolvedValue({
    ...embedder,
    state: 'ready',
    resident: false,
  })
})
afterEach(() => vi.restoreAllMocks())

describe('Startup availability', () => {
  it('explains automatic reranker skipping in German without an encoding placeholder', async () => {
    vi.mocked(window.api.settings.get).mockResolvedValue({
      ...DEFAULT_SETTINGS,
      basic: { ...DEFAULT_SETTINGS.basic, language: 'de' },
    })
    await act(() => refreshSettings())
    const rr = await window.api.reranker.status()
    vi.spyOn(window.api.reranker, 'status').mockResolvedValue({
      ...rr,
      state: 'unloaded',
      policyDecision: {
        allowed: false,
        mode: 'auto',
        source: 'bundled',
        reason: 'low-vram',
        totalVramGB: 4.1,
      },
    })
    const enter = vi.fn()
    const { container } = render(<WarmingView onReady={enter} />)
    expect(await screen.findByText('Automatisch aus')).toBeVisible()
    expect(screen.getByText(/Grafikspeicher für den Chat/)).toBeVisible()
    expect(screen.getByText(/Dokumentsuche funktioniert auch ohne/)).toBeVisible()
    expect(screen.getByText('Bei Bedarf')).toBeVisible()
    expect(container).not.toHaveTextContent('?bersprungen')
    expect(enter).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Arbeitsbereich öffnen' }))
    expect(enter).toHaveBeenCalledOnce()
  })

  it('never blocks usable core tools on optional refinement', async () => {
    const llm = await window.api.llm.status()
    vi.mocked(window.api.llm.status).mockResolvedValue({ ...llm, state: 'ready', resident: true })
    const rr = await window.api.reranker.status()
    vi.spyOn(window.api.reranker, 'status').mockResolvedValue({ ...rr, state: 'failed' })
    const enter = vi.fn()
    render(<WarmingView onReady={enter} />)
    await waitFor(() => expect(enter).toHaveBeenCalledOnce())
  })

  it('does not gate ready core tools on an optional status-read failure', async () => {
    const llm = await window.api.llm.status()
    vi.mocked(window.api.llm.status).mockResolvedValue({ ...llm, state: 'ready', resident: true })
    vi.spyOn(window.api.reranker, 'status').mockRejectedValue(
      new Error('Optional status unavailable'),
    )
    const enter = vi.fn()
    render(<WarmingView onReady={enter} />)
    await waitFor(() => expect(enter).toHaveBeenCalledOnce())
  })

  it('clears a failed core read when a newer live status succeeds', async () => {
    const llm = await window.api.llm.status()
    vi.mocked(window.api.llm.status).mockRejectedValueOnce(new Error('Status unavailable'))
    let emit!: (status: ModelStatus) => void
    vi.spyOn(window.api.llm, 'onStatus').mockImplementation((callback) => {
      emit = callback
      return () => {}
    })
    const enter = vi.fn()
    render(<WarmingView onReady={enter} />)
    await screen.findByRole('alert')
    expect(enter).not.toHaveBeenCalled()
    act(() => emit({ ...llm, state: 'ready', resident: true }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await waitFor(() => expect(enter).toHaveBeenCalledOnce())
  })

  it('ignores a stale read rejection after a newer valid push', async () => {
    const llm = await window.api.llm.status()
    let reject!: (reason: Error) => void
    vi.mocked(window.api.llm.status).mockReturnValue(
      new Promise((_resolve, fail) => {
        reject = fail
      }),
    )
    let emit!: (status: ModelStatus) => void
    vi.spyOn(window.api.llm, 'onStatus').mockImplementation((callback) => {
      emit = callback
      return () => {}
    })
    const enter = vi.fn()
    render(<WarmingView onReady={enter} />)
    act(() => emit({ ...llm, state: 'ready', resident: true }))
    await act(async () => reject(new Error('Old snapshot failed')))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(enter).toHaveBeenCalledOnce()
  })

  it('keeps preparation retry disabled while core models are still loading', async () => {
    const llm = await window.api.llm.status()
    vi.spyOn(window.api.reranker, 'status').mockRejectedValue(
      new Error('Optional status unavailable'),
    )
    const warmup = vi.spyOn(window.api.models, 'warmupForQa').mockResolvedValue()
    let emit!: (status: ModelStatus) => void
    vi.spyOn(window.api.llm, 'onStatus').mockImplementation((callback) => {
      emit = callback
      return () => {}
    })
    render(<WarmingView onReady={() => {}} />)
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: 'Retrying…' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Retrying…' }))
    expect(warmup).toHaveBeenCalledOnce()
    act(() => emit({ ...llm, state: 'failed' }))
    expect(screen.getByRole('button', { name: 'Retry preparation' })).toBeEnabled()
  })

  it('keeps model failure actionable and permits opening the workspace', async () => {
    const llm = await window.api.llm.status()
    vi.mocked(window.api.llm.status).mockResolvedValue({ ...llm, state: 'failed' })
    const enter = vi.fn()
    const settings = vi.fn()
    render(<WarmingView onReady={enter} onOpenSettings={settings} />)
    await screen.findByText('Some AI tools need attention')
    expect(screen.getByText(/Check the selected model and GPU/)).toBeVisible()
    expect(enter).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Model settings' }))
    expect(settings).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }))
    expect(enter).toHaveBeenCalledOnce()
  })

  it('reports a failed status read and retries it without an unhandled rejection', async () => {
    const llm = await window.api.llm.status()
    vi.mocked(window.api.llm.status)
      .mockRejectedValueOnce(new Error('IPC failed'))
      .mockResolvedValue(llm)
    render(<WarmingView onReady={() => {}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Status could not be checked')
    fireEvent.click(screen.getByRole('button', { name: 'Retry preparation' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(screen.getByRole('progressbar', { name: 'Chat' })).toHaveAttribute('value', '0.42')
  })

  it('does not overwrite a newer pushed status with the initial snapshot', async () => {
    let emit!: (status: ModelStatus) => void
    vi.spyOn(window.api.llm, 'onStatus').mockImplementation((cb) => {
      emit = cb
      return () => {}
    })
    const llm = await window.api.llm.status()
    let resolve!: (value: ModelStatus) => void
    vi.mocked(window.api.llm.status).mockReturnValue(
      new Promise((done) => {
        resolve = done
      }),
    )
    const enter = vi.fn()
    render(<WarmingView onReady={enter} />)
    act(() => emit({ ...llm, state: 'failed' }))
    await act(async () => resolve({ ...llm, state: 'ready' }))
    expect(screen.getByText('Some AI tools need attention')).toBeVisible()
    expect(enter).not.toHaveBeenCalled()
  })

  it('updates an optional policy reason from live events', async () => {
    let emit!: (status: RerankerStatus) => void
    vi.spyOn(window.api.reranker, 'onStatus').mockImplementation((cb) => {
      emit = cb
      return () => {}
    })
    const rr = await window.api.reranker.status()
    render(<WarmingView onReady={() => {}} />)
    act(() =>
      emit({
        ...rr,
        state: 'unloaded',
        policyDecision: {
          allowed: false,
          mode: 'auto',
          source: 'bundled',
          reason: 'low-vram',
          totalVramGB: 4,
        },
      }),
    )
    expect(screen.getByText('Off in Auto')).toBeVisible()
    expect(screen.getByText(/Document search still works without/)).toBeVisible()
  })
})
