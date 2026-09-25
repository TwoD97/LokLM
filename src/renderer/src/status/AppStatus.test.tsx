import { useEffect } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackfillStatus, ModelStatus } from '@shared/documents'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { IDLE_MODEL_TRANSITION, type ModelActivity } from '@shared/modelActivity'
import { GenerationProvider, useGeneration } from '../generation/GenerationContext'
import { refreshSettings } from '../settings/useSettings'
import { TitleBar } from '../TitleBar'
import { AppStatus } from './AppStatus'

let emitChat: (value: ModelStatus) => void
let emitActivity: (value: ModelActivity) => void
let emitBackfill: (value: BackfillStatus) => void
let chat: ModelStatus

beforeEach(async () => {
  vi.spyOn(window.api.settings, 'get').mockResolvedValue({
    ...DEFAULT_SETTINGS,
    basic: { ...DEFAULT_SETTINGS.basic, language: 'en' },
  })
  await act(() => refreshSettings())
  chat = { ...(await window.api.llm.status()), state: 'ready', resident: true }
  const search = {
    ...(await window.api.embedder.status()),
    state: 'ready' as const,
    resident: false,
  }
  const refinement = {
    ...(await window.api.reranker.status()),
    state: 'unloaded' as const,
    policyDecision: {
      allowed: false,
      mode: 'auto' as const,
      source: 'bundled' as const,
      reason: 'low-vram' as const,
      totalVramGB: 4.1,
    },
  }
  vi.spyOn(window.api.llm, 'status').mockResolvedValue(chat)
  vi.spyOn(window.api.embedder, 'status').mockResolvedValue(search)
  vi.spyOn(window.api.reranker, 'status').mockResolvedValue(refinement)
  vi.spyOn(window.api.translation, 'status').mockResolvedValue({
    state: 'ready',
    message: null,
    modelName: 'Chat model',
  })
  vi.spyOn(window.api.transcription, 'modelStatus').mockResolvedValue([
    { id: 'small', present: true, downloading: false, bytes: 1000 },
  ])
  vi.spyOn(window.api.llm, 'onStatus').mockImplementation((callback) => {
    emitChat = callback
    return () => {}
  })
  vi.spyOn(window.api.models, 'onActivity').mockImplementation((callback) => {
    emitActivity = callback
    return () => {}
  })
  vi.spyOn(window.api.embedder, 'onBackfillStatus').mockImplementation((callback) => {
    emitBackfill = callback
    return () => {}
  })
})
afterEach(() => vi.restoreAllMocks())

const capability = (name: string) => within(screen.getByRole('heading', { name }).closest('li')!)
const open = async () => {
  const button = await screen.findByRole('button', { name: /Show activity and AI status/ })
  fireEvent.click(button)
  return button
}

describe('task-oriented app status', () => {
  it('explains capability availability without claiming parked or installed models are ready', async () => {
    render(<AppStatus />)
    await screen.findByRole('button', { name: /^Chat ready/ })
    await open()
    expect(capability('Chat').getByText('Ready')).toBeVisible()
    expect(capability('Document search').getByText('On demand')).toBeVisible()
    expect(capability('Search refinement').getByText('Skipped')).toBeVisible()
    expect(capability('Audio transcription').getByText('On demand')).toBeVisible()
    expect(capability('Translation').getByText(/same model and queue as chat/)).toBeVisible()
    act(() => emitChat({ ...chat, state: 'unloaded', resident: false }))
    expect(capability('Chat').getByText('Not loaded')).toBeVisible()
    expect(screen.getByRole('button', { name: /^Chat not loaded/ })).toBeVisible()
  })

  it('renders skipped refinement in German with proper characters', async () => {
    vi.mocked(window.api.settings.get).mockResolvedValue({
      ...DEFAULT_SETTINGS,
      basic: { ...DEFAULT_SETTINGS.basic, language: 'de' },
    })
    await act(() => refreshSettings())
    render(<AppStatus />)
    fireEvent.click(await screen.findByRole('button', { name: /^Chat bereit/ }))
    expect(capability('Trefferprüfung').getByText('Übersprungen')).toBeVisible()
    expect(
      capability('Trefferprüfung').getByText(/hybride Dokumentsuche bleibt verfügbar/),
    ).toBeVisible()
    expect(capability('Übersetzung').getByText(/dasselbe Modell/)).toBeVisible()
  })

  it('supports keyboard dismissal, focus restoration, outside clicks and a System shortcut', async () => {
    const settings = vi.fn()
    render(
      <>
        <AppStatus onOpenSettings={settings} />
        <button>Outside</button>
      </>,
    )
    const trigger = await open()
    expect(screen.getByRole('dialog', { name: 'Activity and AI' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    fireEvent.click(trigger)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Open System settings' }))
    expect(settings).toHaveBeenCalledWith('system')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('prioritizes indexing, shows queued work, and safely stops after the current batch', async () => {
    function Jobs() {
      const { begin } = useGeneration()
      useEffect(() => {
        const stopChat = begin('chat', 'Market outlook')
        const stopTranslation = begin('translation', 'Handout')
        const stopAudio = begin('transcription', 'Interview')
        return () => {
          stopChat()
          stopTranslation()
          stopAudio()
        }
      }, [begin])
      return null
    }
    const cancel = vi
      .spyOn(window.api.models, 'cancelIndexing')
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValue()
    render(
      <GenerationProvider>
        <Jobs />
        <AppStatus />
      </GenerationProvider>,
    )
    act(() =>
      emitActivity({
        ...IDLE_MODEL_TRANSITION,
        phase: 'indexing',
        jobs: [{ workspaceId: 1, title: 'Report.pdf', done: 4, total: 10 }],
      }),
    )
    expect(screen.getByRole('button', { name: /^Indexing documents/ })).toBeVisible()
    await open()
    expect(capability('Document search').getByText('4 of 10 passages')).toBeVisible()
    expect(
      within(screen.getByRole('region', { name: 'In progress' })).getAllByText('Waiting'),
    ).toHaveLength(2)
    expect(capability('Chat').getByText('Waiting')).toBeVisible()
    expect(capability('Translation').getByText('Waiting')).toBeVisible()
    expect(capability('Audio transcription').getByText('Working')).toBeVisible()
    expect(screen.getByText('Report.pdf')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Stop indexing' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Indexing could not be stopped')
    fireEvent.click(screen.getByRole('button', { name: 'Stop indexing' }))
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('button', { name: 'Stopping after this batch' })).toBeDisabled()
    act(() =>
      emitActivity({ ...IDLE_MODEL_TRANSITION, phase: 'restoring', target: 'llm', jobs: [] }),
    )
    expect(screen.getByRole('button', { name: /^Returning to chat/ })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Stopping after this batch' }),
    ).not.toBeInTheDocument()
  })

  it('does not overwrite a new status event with a stale initial read', async () => {
    let resolve: (value: ModelStatus) => void = () => {}
    vi.mocked(window.api.llm.status).mockReturnValue(
      new Promise((done) => {
        resolve = done
      }),
    )
    render(<AppStatus />)
    act(() => emitChat(chat))
    await act(async () => resolve({ ...chat, state: 'loading' }))
    expect(screen.getByRole('button', { name: /^Chat ready/ })).toBeVisible()
  })

  it('recovers a failed initial read when a valid status event arrives', async () => {
    vi.mocked(window.api.llm.status).mockRejectedValueOnce(new Error('Temporary IPC failure'))
    render(<AppStatus />)
    await screen.findByRole('button', { name: /^AI needs attention/ })
    act(() => emitChat(chat))
    expect(screen.getByRole('button', { name: /^Chat ready/ })).toBeVisible()
  })

  it('surfaces backfill failures and leaves technical errors in an expandable detail', async () => {
    render(<AppStatus onOpenSettings={vi.fn()} />)
    await screen.findByRole('button', { name: /^Chat ready/ })
    act(() =>
      emitBackfill({
        workspaceId: 1,
        state: 'failed',
        done: 3,
        total: 8,
        message: 'Embedding worker exited.',
      }),
    )
    await open()
    expect(screen.getByRole('button', { name: /^AI needs attention/ })).toBeVisible()
    expect(capability('Document search').getByText('Needs attention')).toBeVisible()
    expect(screen.getByText('Embedding worker exited.').closest('details')).not.toHaveAttribute(
      'open',
    )
  })

  it('removes disabled optional modules and refreshes audio installation on opening details', async () => {
    vi.mocked(window.api.settings.get).mockResolvedValue({
      ...DEFAULT_SETTINGS,
      basic: {
        ...DEFAULT_SETTINGS.basic,
        language: 'en',
        modules: { ...DEFAULT_SETTINGS.basic.modules, translation: false },
      },
    })
    await act(() => refreshSettings())
    vi.mocked(window.api.transcription.modelStatus).mockResolvedValueOnce([])
    render(<AppStatus />)
    await screen.findByRole('button', { name: /^Chat ready/ })
    await open()
    expect(screen.queryByRole('heading', { name: 'Translation' })).not.toBeInTheDocument()
    await waitFor(() =>
      expect(capability('Audio transcription').getByText('On demand')).toBeVisible(),
    )
  })

  it('never subscribes to private work while the app is locked', async () => {
    render(<TitleBar unlocked={false} />)
    expect(
      screen.queryByRole('button', { name: /Show activity and AI status/ }),
    ).not.toBeInTheDocument()
    expect(window.api.models.onActivity).not.toHaveBeenCalled()
    expect(window.api.llm.status).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Minimize' })).toBeVisible()
  })
})
