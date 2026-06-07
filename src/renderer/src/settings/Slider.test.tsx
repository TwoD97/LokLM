import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Slider } from './Slider'

describe('Slider', () => {
  it('shows the current value via the format fn', () => {
    render(
      <Slider
        value={2000}
        min={500}
        max={8000}
        step={100}
        ariaLabel="Chunk"
        format={(v) => `${v} Zeichen`}
        onChange={() => {}}
      />,
    )
    expect(screen.getByText('2000 Zeichen')).toBeInTheDocument()
  })
  it('shows the raw value when no format fn is given', () => {
    render(<Slider value={10} min={3} max={30} ariaLabel="TopK" onChange={() => {}} />)
    expect(screen.getByText('10')).toBeInTheDocument()
  })
  it('calls onChange with the numeric value on input', () => {
    const onChange = vi.fn()
    render(<Slider value={10} min={3} max={30} ariaLabel="TopK" onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('TopK'), { target: { value: '17' } })
    expect(onChange).toHaveBeenCalledWith(17)
  })
  it('exposes min/max/step on the range input', () => {
    render(
      <Slider value={200} min={0} max={500} step={50} ariaLabel="Overlap" onChange={() => {}} />,
    )
    const input = screen.getByLabelText('Overlap') as HTMLInputElement
    expect(input.min).toBe('0')
    expect(input.max).toBe('500')
    expect(input.step).toBe('50')
  })
})
