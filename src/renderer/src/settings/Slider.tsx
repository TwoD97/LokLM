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
  return (
    <div className="settings-slider">
      <input
        type="range"
        className="settings-slider__input"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="settings-slider__value">{format ? format(value) : String(value)}</span>
    </div>
  )
}
