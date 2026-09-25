import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { TranscriptList } from './TranscriptList'
import type { QueueRow } from './useTranscription'

const rows: QueueRow[] = [
  {
    name: 'First.wav',
    phase: 'done',
    segments: [{ start: 0, end: 1, text: 'First transcript' }],
    error: null,
  },
  {
    name: 'Second.wav',
    phase: 'done',
    segments: [{ start: 0, end: 1, text: 'Second transcript' }],
    error: null,
  },
]
afterEach(() => vi.restoreAllMocks())

describe('Transcript queue', () => {
  it('keeps the queue visible while work is active and labels waiting files honestly', () => {
    const clear = vi.fn()
    render(
      <TranscriptList
        rows={[
          { ...rows[0]!, phase: 'transcribing' },
          { ...rows[1]!, phase: 'idle' },
        ]}
        workspaceId={1}
        onClear={clear}
      />,
    )
    expect(screen.getByText('Queued')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(clear).not.toHaveBeenCalled()
  })

  it('reports individual batch save failures, keeps transcripts, and retries only unsaved rows', async () => {
    const save = vi.spyOn(window.api.transcription, 'saveToWorkspace')
    const saved = await window.api.transcription.saveToWorkspace(1, 'placeholder', 'txt')
    save.mockClear().mockRejectedValueOnce(new Error('Disk full')).mockResolvedValue(saved)
    render(<TranscriptList rows={rows} workspaceId={1} onClear={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save all to workspace' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Disk full')
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    await screen.findByRole('button', { name: 'Saved to workspace' })
    fireEvent.click(screen.getByRole('button', { name: 'Save all to workspace' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(3))
    expect(save.mock.calls[2]?.[1]).toContain('First transcript')
    expect(screen.getByText('First.wav')).toBeVisible()
  })

  it('does not attribute a completed save to a different workspace', async () => {
    const view = render(<TranscriptList rows={[rows[0]!]} workspaceId={1} onClear={() => {}} />)
    fireEvent.click(
      within(screen.getByRole('listitem')).getByRole('button', { name: 'Save to workspace' }),
    )
    await screen.findByRole('button', { name: 'Saved to workspace' })
    view.rerender(<TranscriptList rows={[rows[0]!]} workspaceId={2} onClear={() => {}} />)
    expect(
      within(screen.getByRole('listitem')).getByRole('button', { name: 'Save to workspace' }),
    ).toBeEnabled()
  })
})
