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
  it('updates the live readout during drag without persisting', () => {
    const onChange = vi.fn()
    render(<Slider value={10} min={3} max={30} ariaLabel="TopK" onChange={onChange} />)
    const input = screen.getByLabelText('TopK')
    fireEvent.change(input, { target: { value: '22' } })
    expect(screen.getByText('22')).toBeInTheDocument() // readout follows the drag...
    expect(onChange).not.toHaveBeenCalled() // ...but nothing persisted yet
  })
  it('commits the value on release', () => {
    const onChange = vi.fn()
    render(<Slider value={10} min={3} max={30} ariaLabel="TopK" onChange={onChange} />)
    const input = screen.getByLabelText('TopK')
    fireEvent.change(input, { target: { value: '17' } })
    // blur is the jsdom-reliable commit trigger; onPointerUp/onKeyUp are wired to the same commit().
    fireEvent.blur(input)
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
