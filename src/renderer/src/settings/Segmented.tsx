type Option<T extends string> = {
  value: T
  label: string
  disabled?: boolean
  hint?: string | undefined
}

type Props<T extends string> = {
  value: T
  options: Option<T>[]
  onChange: (next: T) => void
  ariaLabel?: string
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: Props<T>): JSX.Element {
  return (
    <div className="settings-segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          disabled={o.disabled}
          title={o.hint}
          className={`settings-segmented__opt ${o.value === value ? 'settings-segmented__opt--active' : ''}`}
          onClick={() => {
            if (o.value !== value && !o.disabled) onChange(o.value)
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
