type Props = {
  id: string
  title: string
  subtitle: string
  open: boolean
  onToggle: () => void
}

/** Native buttons supply Enter/Space activation and keep disclosure state
 * available to assistive technology without custom keyboard emulation. */
export function SectionHeader({ id, title, subtitle, open, onToggle }: Props): JSX.Element {
  return (
    <h3 className="settings-group__heading">
      <button
        id={`${id}-toggle`}
        type="button"
        className="settings-group__header"
        aria-expanded={open}
        aria-controls={`${id}-body`}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        onClick={onToggle}
      >
        <span className="settings-group__title">
          <span id={`${id}-title`} className="settings-group__title-row">
            {title}
          </span>
          <span id={`${id}-description`} className="settings-group__sub">
            {subtitle}
          </span>
        </span>
        <span className="settings-group__chevron" aria-hidden="true">
          ▶
        </span>
      </button>
    </h3>
  )
}
