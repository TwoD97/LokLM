import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import './select.css'

export type SelectOption<T extends string> = { value: T; label: string }

type Props<T extends string> = {
  value: T
  options: ReadonlyArray<SelectOption<T>>
  onChange: (value: T) => void
  /** Accessible name — the control has no visible <label>. */
  ariaLabel: string
  /** Optional muted lead-in shown before the value (e.g. "Date:"), so several
   *  dropdowns whose values can coincide (two "Any" filters) stay distinguishable
   *  at a glance. Purely visual — the accessible name stays `ariaLabel`. */
  prefix?: string
  /** Extra class on the root, for width/spacing tweaks at the call site. */
  className?: string
}

/**
 * A themed, accessible dropdown that replaces the native <select>. The native
 * option popup can't be styled in dark mode on Windows (a custom select
 * background makes Chromium render the popup light — see library.css history),
 * so this renders its own menu using the app's design tokens, which means it
 * looks right in BOTH themes. Keyboard + ARIA parity with a real listbox:
 * Arrow/Home/End to move, Enter/Space to pick, Esc to close, click-outside to
 * dismiss.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  prefix,
  className,
}: Props<T>): JSX.Element {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const baseId = useId()

  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  )
  const current = options[selectedIndex] ?? options[0]
  const menuOpen = open && options.length > 0
  const focusedIndex = Math.min(activeIndex, Math.max(0, options.length - 1))

  const close = useCallback((focusButton = true): void => {
    setOpen(false)
    if (focusButton) buttonRef.current?.focus()
  }, [])

  const openMenu = useCallback((): void => {
    if (options.length === 0) return
    setActiveIndex(selectedIndex)
    setOpen(true)
  }, [selectedIndex, options.length])

  // Dismiss on a pointer press anywhere outside the control.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [open])

  // Move focus into the menu when it opens so arrow keys + SR tracking work.
  useEffect(() => {
    if (menuOpen) listRef.current?.focus()
  }, [menuOpen])

  useEffect(() => {
    if (menuOpen) listRef.current?.children[focusedIndex]?.scrollIntoView?.({ block: 'nearest' })
  }, [menuOpen, focusedIndex])

  const choose = useCallback(
    (i: number): void => {
      const opt = options[i]
      if (opt) onChange(opt.value)
      close()
    },
    [options, onChange, close],
  )

  const onButtonKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openMenu()
    }
  }

  const onListKeyDown = (e: React.KeyboardEvent): void => {
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        close()
        break
      case 'ArrowDown':
        e.preventDefault()
        setActiveIndex(Math.min(options.length - 1, focusedIndex + 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIndex(Math.max(0, focusedIndex - 1))
        break
      case 'Home':
        e.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        e.preventDefault()
        setActiveIndex(options.length - 1)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        choose(focusedIndex)
        break
      case 'Tab':
        // Restore focus before removing the listbox. Native Tab then proceeds
        // from the trigger instead of a detached element (or the page body).
        close()
        break
      default:
        break
    }
  }

  return (
    <div
      ref={rootRef}
      className={`select${className ? ` ${className}` : ''}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close(false)
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="select__trigger"
        aria-haspopup="listbox"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? `${baseId}-list` : undefined}
        aria-label={ariaLabel}
        disabled={options.length === 0}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onButtonKeyDown}
      >
        {prefix && <span className="select__prefix">{prefix}</span>}
        <span className="select__value">{current?.label}</span>
        <ChevronDown size={14} className="select__chevron" aria-hidden="true" />
      </button>
      {menuOpen && (
        <ul
          ref={listRef}
          id={`${baseId}-list`}
          className="select__menu"
          role="listbox"
          tabIndex={-1}
          aria-label={ariaLabel}
          aria-activedescendant={`${baseId}-${focusedIndex}`}
          onKeyDown={onListKeyDown}
        >
          {options.map((opt, i) => (
            <li
              key={opt.value}
              id={`${baseId}-${i}`}
              role="option"
              aria-selected={opt.value === value}
              className={
                'select__option' +
                (i === focusedIndex ? ' select__option--active' : '') +
                (opt.value === value ? ' select__option--selected' : '')
              }
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => choose(i)}
            >
              <span className="select__option-label">{opt.label}</span>
              {opt.value === value && (
                <Check size={14} className="select__option-check" aria-hidden="true" />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
