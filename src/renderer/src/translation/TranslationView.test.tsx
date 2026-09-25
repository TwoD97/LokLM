import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Document } from '@shared/documents'
import { TRANSLATION_LANGUAGES } from '@shared/translation'
import { TranslationView } from './TranslationView'

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
})
