export const ORGANIZER_NAVIGATE_EVENT = 'loklm:organizer-open-item'

export type OrganizerNavigationTarget = {
  kind: 'notes' | 'tasks' | 'events'
  id: string
}

let pending: OrganizerNavigationTarget | null = null

/** Keep the target until the lazily loaded organizer can receive it. */
export function openOrganizerItem(target: OrganizerNavigationTarget): void {
  pending = { ...target }
  window.dispatchEvent(new CustomEvent(ORGANIZER_NAVIGATE_EVENT, { detail: pending }))
}

export function takeOrganizerNavigation(): OrganizerNavigationTarget | null {
  const target = pending
  pending = null
  return target
}

/** Clear account-local navigation when the unlocked shell is disposed. */
export function clearOrganizerNavigation(): void {
  pending = null
}
