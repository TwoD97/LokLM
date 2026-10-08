import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { Document } from '@shared/documents'
import { transformCitationMarkers } from '@shared/citationMarkers'
import { MessageList } from './MessageList'

const locale = vi.hoisted(() => ({ language: 'en' }))
vi.mock('../settings/useSettings', () => ({
  useSettings: () => ({ settings: { basic: { language: locale.language } } }),
}))
vi.mock('@shared/citationMarkers', async (original) => {
  const actual = await original<typeof import('@shared/citationMarkers')>()
  return { ...actual, transformCitationMarkers: vi.fn(actual.transformCitationMarkers) }
})

beforeEach(() => {
  locale.language = 'en'
  vi.mocked(transformCitationMarkers).mockClear()
})

describe('source processing during streaming', () => {
  it('does not rescan finished history when only the live answer changes', () => {
    const history = Array.from({ length: 8 }, (_, index) => ({
      id: `history-${index}`,
      role: 'assistant' as const,
      content: `Finished answer ${index}. [doc:1, chunk:11]`,
      streaming: false,
      citations: [{ documentId: 1, chunkId: 11 }],
    }))
    const stable = {
      documents: [],
      keepPipelineVisible: false,
      onCopy: vi.fn(),
      onCitationClick: vi.fn(),
    }
    const messages = (content: string) => [
      ...history,
      {
        id: 'live',
        role: 'assistant' as const,
        content,
        streaming: true,
      },
    ]
    const view = render(<MessageList {...stable} messages={messages('First')} />)
    const historyTexts = new Set(history.map((message) => message.content))
    const scans = () =>
      vi.mocked(transformCitationMarkers).mock.calls.filter(([text]) => historyTexts.has(text))
        .length
    expect(scans()).toBe(16) // One inline-chip scan and one source-menu scan per answer.
    for (const content of ['First second', 'First second third', 'First second third fourth']) {
      view.rerender(<MessageList {...stable} messages={messages(content)} />)
    }
    expect(scans()).toBe(16)
  })

  it('still updates translated labels, answer order, allowed citations and document names', () => {
    const stable = { keepPipelineVisible: false, onCopy: vi.fn(), onCitationClick: vi.fn() }
    let message: ComponentProps<typeof MessageList>['messages'][number] = {
      id: 'answer',
      role: 'assistant',
      streaming: false,
      content: 'First [doc:1, chunk:11], second [doc:2, chunk:22].',
      citations: [
        { documentId: 1, chunkId: 11 },
        { documentId: 2, chunkId: 22 },
      ],
    }
    let documents: Document[] = []
    const ui = () => <MessageList {...stable} messages={[message]} documents={documents} />
    const view = render(ui())
    fireEvent.click(screen.getByRole('button', { name: '2 cited sources' }))
    expect(
      within(screen.getByRole('menu'))
        .getAllByRole('menuitem')
        .map((row) => row.textContent),
    ).toEqual(['1Document #1', '2Document #2'])
    locale.language = 'de'
    view.rerender(ui())
    expect(screen.getByRole('button', { name: '2 zitierte Quellen' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: '1 Dokument #1' })).toBeVisible()
    documents = [{ id: 1, title: 'Updated title', sourcePath: '/updated.md' }] as Document[]
    view.rerender(ui())
    expect(screen.getByRole('menuitem', { name: '1 Updated title' })).toBeVisible()
    message = { ...message, content: 'Second [doc:2, chunk:22], first [doc:1, chunk:11].' }
    view.rerender(ui())
    expect(screen.getByRole('menuitem', { name: '1 Dokument #2' })).toBeVisible()
    message = { ...message, citations: [{ documentId: 1, chunkId: 11 }] }
    view.rerender(ui())
    expect(screen.getByRole('button', { name: '1 zitierte Quelle' })).toBeVisible()
    expect(screen.getAllByRole('menuitem')).toHaveLength(1)
    expect(screen.getByRole('menuitem', { name: '1 Updated title' })).toBeVisible()
    expect(view.container.querySelectorAll('.citation-chip')).toHaveLength(1)
    expect(view.container).toHaveTextContent('[doc:2, chunk:22]')
  })
})
