import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Document } from '@shared/documents'
import {
  TRANSLATION_LANGUAGES,
  type TranslatorStatus,
  type TranslateResult,
} from '@shared/translation'
import { TranslationView } from './TranslationView'

const { endJob, beginJob } = vi.hoisted(() => {
  const endJob = vi.fn()
  return { endJob, beginJob: vi.fn(() => endJob) }
})
vi.mock('../generation/GenerationContext', () => ({
  useGeneration: () => ({ begin: beginJob }),
}))

const doc = (id: number): Document => ({
  id,
  workspaceId: 1,
  title: `Document ${id}`,
  sourcePath: `/doc${id}.txt`,
  mimeType: 'text/plain',
  byteSize: 5,
  status: 'ready',
  chunkCount: 1,
  tokenCount: 1,
  addedAt: 1,
  pinned: false,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(window.api.translation, 'status').mockResolvedValue({
    state: 'ready',
    message: null,
    modelName: 'Local',
  })
  vi.spyOn(window.api.translation, 'languages').mockResolvedValue([...TRANSLATION_LANGUAGES])
  vi.spyOn(window.api.workspaces, 'list').mockResolvedValue([
    { id: 1, name: 'Research', createdAt: 1, type: 'library', encryptionLevel: 'full' },
  ])
  vi.spyOn(window.api.documents, 'list').mockResolvedValue([doc(1), doc(2)])
})
afterEach(() => vi.restoreAllMocks())

async function selectDocument(id: number): Promise<void> {
  fireEvent.click(await screen.findByRole('tab', { name: 'Document' }))
  await screen.findByRole('option', { name: `Document ${id}` })
  fireEvent.change(screen.getByRole('combobox', { name: 'Choose a document…' }), {
    target: { value: String(id) },
  })
}

describe('Translation workflow', () => {
  it('clears the old source when the next document cannot load', async () => {
    vi.spyOn(window.api.translation, 'documentText')
      .mockResolvedValueOnce({ title: 'One', text: 'Old source' })
      .mockRejectedValueOnce(new Error('Unreadable document'))
    render(<TranslationView />)
    await selectDocument(1)
    await screen.findByDisplayValue('Old source')
    await selectDocument(2)
    expect(await screen.findByRole('alert')).toHaveTextContent('Unreadable document')
    expect(screen.getByRole('textbox', { name: 'Source text' })).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Translate' })).toBeDisabled()
  })

  it('retains translated output on save failure and makes a retry possible', async () => {
    vi.spyOn(window.api.translation, 'documentText').mockResolvedValue({
      title: 'One',
      text: 'Source text',
    })
    vi.spyOn(window.api.translation, 'translate').mockResolvedValue({
      text: 'Translated output',
      detected: 'en',
      sentences: 1,
      ms: 10,
    })
    vi.spyOn(window.api.translation, 'saveDocument').mockRejectedValue(new Error('Disk full'))
    render(<TranslationView />)
    await selectDocument(1)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Translate' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }))
    await screen.findByText('Translated output')
    fireEvent.click(screen.getByRole('button', { name: 'Save to workspace' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Disk full')
    expect(screen.getByText('Translated output')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save to workspace' })).toBeEnabled()
  })

  it('offers recovery instead of a blank page when the availability check fails', async () => {
    vi.mocked(window.api.translation.status).mockRejectedValueOnce(new Error('IPC unavailable'))
    render(<TranslationView />)
    expect(await screen.findByRole('alert')).toHaveTextContent('IPC unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('tab', { name: 'Text' })).toBeVisible()
  })

  it.each(['resolve', 'reject'] as const)(
    'keeps a live status event ahead of a late initial %s',
    async (kind) => {
      let resolve!: (status: TranslatorStatus) => void
      let reject!: (error: Error) => void
      vi.mocked(window.api.translation.status).mockImplementation(
        () =>
          new Promise((done, fail) => {
            resolve = done
            reject = fail
          }),
      )
      let onStatus!: (status: TranslatorStatus) => void
      vi.spyOn(window.api.translation, 'onStatus').mockImplementation((callback) => {
        onStatus = callback
        return vi.fn()
      })
      render(<TranslationView />)
      act(() => onStatus({ state: 'ready', message: null, modelName: 'Local' }))
      expect(screen.getByRole('tab', { name: 'Text' })).toBeVisible()
      await act(async () => {
        if (kind === 'resolve') resolve({ state: 'not_installed', message: null, modelName: null })
        else reject(new Error('stale connection failure'))
      })
      expect(screen.getByRole('tab', { name: 'Text' })).toBeVisible()
      expect(screen.queryByRole('alert')).toBeNull()
    },
  )

  it('cancels on unmount and keeps activity until translation settles', async () => {
    let finish!: (value: TranslateResult) => void
    vi.spyOn(window.api.translation, 'translate').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const cancel = vi.spyOn(window.api.translation, 'cancel').mockResolvedValue()
    const view = render(<TranslationView />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Source text' }), {
      target: { value: 'Original' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }))
    expect(beginJob).toHaveBeenCalledWith('translation')
    view.unmount()
    expect(cancel).toHaveBeenCalledOnce()
    expect(endJob).not.toHaveBeenCalled()
    await act(async () => finish({ text: 'Late text', detected: 'en', sentences: 1, ms: 10 }))
    expect(endJob).toHaveBeenCalledOnce()
  })

  it('supports keyboard selection in the source tabs', async () => {
    render(<TranslationView />)
    const textTab = await screen.findByRole('tab', { name: 'Text' })
    const docTab = screen.getByRole('tab', { name: 'Document' })
    textTab.focus()
    fireEvent.keyDown(textTab, { key: 'ArrowRight' })
    expect(docTab).toHaveFocus()
    expect(docTab).toHaveAttribute('aria-selected', 'true')
    expect(textTab).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', docTab.id)
    fireEvent.keyDown(docTab, { key: 'Home' })
    expect(textTab).toHaveFocus()
  })
})
