import { useEffect, type RefObject } from 'react'

/** Keep Tab inside an open modal and return focus to its opener on close. */
export function useModalFocus(ref: RefObject<HTMLElement>, open: boolean): void {
  useEffect(() => {
    const modal = ref.current
    if (!open || !modal) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusable = (): HTMLElement[] =>
      Array.from(
        modal.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
        ),
      ).filter((element) => element.tabIndex >= 0 && !element.closest('[hidden], [inert]'))
    const initial = modal.querySelector<HTMLElement>('[aria-selected="true"]') ?? focusable()[0]
    initial?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab' || event.defaultPrevented) return
      const elements = focusable()
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (!first || !last) {
        event.preventDefault()
        modal.focus()
        return
      }
      if (
        event.shiftKey &&
        (document.activeElement === first || !modal.contains(document.activeElement))
      ) {
        event.preventDefault()
        last.focus()
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !modal.contains(document.activeElement))
      ) {
        event.preventDefault()
        first.focus()
      }
    }
    modal.addEventListener('keydown', onKeyDown)
    return () => {
      modal.removeEventListener('keydown', onKeyDown)
      if (opener?.isConnected) opener.focus()
    }
  }, [open, ref])
}
