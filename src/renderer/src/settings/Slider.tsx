import { useEffect, useState } from 'react'

type Props = {
  value: number
  min: number
  max: number
  step?: number
  onChange: (next: number) => void
  ariaLabel?: string
  /** Formats the live value readout (e.g. add a unit). Defaults to String(value). */
  format?: (v: number) => string
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  ariaLabel,
  format,
}: Props): JSX.Element {
  // Show a live value while dragging, but only persist (onChange) on release — a
  // native range fires onChange on every move, which would otherwise hammer the
  // settings DB with a write per step of the drag.
  const [live, setLive] = useState(value)
  useEffect(() => setLive(value), [value])

  const commit = (v: number): void => {
    if (v !== value) onChange(v)
  }

  return (
    <div className="settings-slider">
      <input
        type="range"
        className="settings-slider__input"
        min={min}
        max={max}
        step={step}
        value={live}
        aria-label={ariaLabel}
        onChange={(e) => setLive(Number(e.target.value))}
        onPointerUp={(e) => commit(Number(e.currentTarget.value))}
        onKeyUp={(e) => commit(Number(e.currentTarget.value))}
        onBlur={(e) => commit(Number(e.currentTarget.value))}
      />
      <span className="settings-slider__value">{format ? format(live) : String(live)}</span>
    </div>
  )
}
