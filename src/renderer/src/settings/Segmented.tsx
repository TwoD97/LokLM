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
  const enabled = options.filter((option) => !option.disabled)
  const tabStop = enabled.some((option) => option.value === value) ? value : enabled[0]?.value
  return (
    <div className="settings-segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={o.disabled}
          tabIndex={o.value === tabStop ? 0 : -1}
          title={o.hint}
          className={`settings-segmented__opt ${o.value === value ? 'settings-segmented__opt--active' : ''}`}
          onClick={() => {
            if (o.value !== value && !o.disabled) onChange(o.value)
          }}
          onKeyDown={(event) => {
            const index = enabled.findIndex((option) => option.value === o.value)
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? enabled.length - 1
                  : ['ArrowRight', 'ArrowDown'].includes(event.key)
                    ? (index + 1) % enabled.length
                    : ['ArrowLeft', 'ArrowUp'].includes(event.key)
                      ? (index + enabled.length - 1) % enabled.length
                      : null
            if (next === null || !enabled[next]) return
            event.preventDefault()
            event.stopPropagation()
            const option = enabled[next]!
            const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
              '[role="radio"]:not(:disabled)',
            )
            buttons?.[next]?.focus()
            if (option.value !== value) onChange(option.value)
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
