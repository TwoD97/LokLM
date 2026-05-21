import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QuestionCard } from './QuestionCard'
import type { QuizQuestion } from '@shared/quiz'

const QUESTION: QuizQuestion = {
  id: 1,
  deckId: 1,
  ordinal: 0,
  stem: 'What colour is the sky?',
  options: ['Red', 'Blue', 'Green', 'Yellow'],
  correctIndex: 1,
  explanation: 'Sky is blue under typical daylight scattering.',
  sourceChunkIds: [42],
  themeTitle: 'Sky',
}

describe('QuestionCard', () => {
  it('renders the stem and four option buttons', () => {
    render(
      <QuestionCard
        question={QUESTION}
        selectedIndex={null}
        revealed={false}
        onSelect={() => undefined}
        onCite={() => undefined}
      />,
    )
    expect(screen.getByText(QUESTION.stem)).toBeInTheDocument()
    for (const opt of QUESTION.options) {
      expect(screen.getByText(opt)).toBeInTheDocument()
    }
  })

  it('calls onSelect when an option is clicked while unrevealed', () => {
    const onSelect = vi.fn()
    render(
      <QuestionCard
        question={QUESTION}
        selectedIndex={null}
        revealed={false}
        onSelect={onSelect}
        onCite={() => undefined}
      />,
    )
    fireEvent.click(screen.getByText('Blue'))
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('shows explanation and citation button when revealed', () => {
    const onCite = vi.fn()
    render(
      <QuestionCard
        question={QUESTION}
        selectedIndex={0}
        revealed={true}
        onSelect={() => undefined}
        onCite={onCite}
      />,
    )
    expect(screen.getByText(QUESTION.explanation)).toBeInTheDocument()
    fireEvent.click(screen.getByText('View source'))
    expect(onCite).toHaveBeenCalledWith(42)
  })

  it('keyboard 1–4 selects the matching option', () => {
    const onSelect = vi.fn()
    render(
      <QuestionCard
        question={QUESTION}
        selectedIndex={null}
        revealed={false}
        onSelect={onSelect}
        onCite={() => undefined}
      />,
    )
    fireEvent.keyDown(window, { key: '3' })
    expect(onSelect).toHaveBeenCalledWith(2)
  })

  it('disables option buttons after reveal', () => {
    render(
      <QuestionCard
        question={QUESTION}
        selectedIndex={0}
        revealed={true}
        onSelect={() => undefined}
        onCite={() => undefined}
      />,
    )
    // All four option buttons should be disabled.
    const blue = screen.getByText('Blue').closest('button')
    expect(blue?.disabled).toBe(true)
  })
})
