import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MessageList } from './MessageList'

const locale = vi.hoisted(() => ({ language: 'en' }))
vi.mock('../settings/useSettings', () => ({
  useSettings: () => ({ settings: { basic: { language: locale.language } } }),
}))

describe('source navigation labels', () => {
  it.each([
    ['en', 'No inline marker.', 'Provided sources · 1'],
    ['de', 'Keine Quellenmarkierung.', 'Quellen im Kontext · 1'],
    ['en', 'Claim [doc:1, chunk:11].', '1 cited source'],
    ['de', 'Aussage [doc:1, chunk:11].', '1 zitierte Quelle'],
    ['en', 'Example `[doc:1, chunk:11]`.', 'Provided sources · 1'],
  ])('distinguishes supplied context from prose citations in %s', (language, content, label) => {
    locale.language = language!
    render(
      <MessageList
        messages={[
          {
            id: 'answer',
            role: 'assistant',
            content: content!,
            streaming: false,
            citations: [{ documentId: 1, chunkId: 11 }],
          },
        ]}
        documents={[]}
        keepPipelineVisible={false}
        onCopy={vi.fn()}
        onCitationClick={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: label })).toBeVisible()
  })
})

describe('finished preparation status', () => {
  it.each([
    ['en', 'Incomplete'],
    ['de', 'Nicht abgeschlossen'],
  ])('shows interrupted work neutrally in %s', (language, label) => {
    locale.language = language!
    const view = render(
      <MessageList
        messages={[
          {
            id: 'answer',
            role: 'assistant',
            content: 'Partial answer. Response interrupted.',
            streaming: false,
            pipeline: [{ stage: 'retrieve', status: 'running' }],
          },
        ]}
        documents={[]}
        keepPipelineVisible={true}
        onCopy={vi.fn()}
        onCitationClick={vi.fn()}
      />,
    )
    expect(screen.getByText(label!)).toBeVisible()
    expect(view.container.querySelector('.chat__pipeline-check')).toBeNull()
    fireEvent.click(view.container.querySelector('.chat__pipeline-toggle')!)
    expect(view.container.querySelector('.chat__pipeline-row--running')).toBeNull()
  })

  it('keeps completed preparation marked done when generation later failed', () => {
    locale.language = 'en'
    const view = render(
      <MessageList
        messages={[
          {
            id: 'answer',
            role: 'assistant',
            content: 'Partial answer. Response interrupted.',
            streaming: false,
            pipeline: [{ stage: 'retrieve', status: 'done', durationMs: 100 }],
          },
        ]}
        documents={[]}
        keepPipelineVisible={true}
        onCopy={vi.fn()}
        onCitationClick={vi.fn()}
      />,
    )
    expect(view.container.querySelector('.chat__pipeline-check')).not.toBeNull()
    expect(view.container.querySelector('.chat__pipeline-summary')).toHaveTextContent('Done')
    expect(screen.queryByText('Incomplete')).toBeNull()
  })
})
