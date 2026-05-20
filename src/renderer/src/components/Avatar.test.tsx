import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Avatar } from './Avatar'

describe('Avatar', () => {
  it('renders the image when bytes are provided', () => {
    const { container } = render(
      <Avatar bytes={new Uint8Array([1, 2, 3])} name="Denys" size={48} />,
    )
    expect(container.querySelector('img')).toBeTruthy()
  })

  it('renders initials with a deterministic color when no bytes', () => {
    const { container } = render(<Avatar bytes={null} name="Denys" size={48} />)
    expect(container.textContent).toContain('D')
    const a = container.querySelector('[data-testid="avatar-initials"]')!
    const c1 = (a as HTMLElement).style.backgroundColor
    const { container: c2 } = render(<Avatar bytes={null} name="Denys" size={48} />)
    const c2bg = (c2.querySelector('[data-testid="avatar-initials"]') as HTMLElement).style
      .backgroundColor
    expect(c1).toBe(c2bg)
  })

  it('falls back to "?" when name is empty', () => {
    const { container } = render(<Avatar bytes={null} name="" size={32} />)
    expect(container.textContent).toContain('?')
  })
})
