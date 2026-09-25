export function dateKey(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function localDate(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  const date = new Date(0)
  date.setFullYear(year!, month! - 1, day!)
  date.setHours(12, 0, 0, 0)
  return date
}

export function moveDate(key: string, days: number): string {
  const date = localDate(key)
  date.setDate(date.getDate() + days)
  return dateKey(date)
}

export function monthDays(month: string, weekStartsOn: 0 | 1): string[] {
  const first = localDate(`${month}-01`)
  const offset = (first.getDay() - weekStartsOn + 7) % 7
  first.setDate(first.getDate() - offset)
  return Array.from({ length: 42 }, (_, i) => moveDate(dateKey(first), i))
}

export function moveMonth(month: string, offset: number): string {
  const first = localDate(`${month}-01`)
  first.setMonth(first.getMonth() + offset)
  return dateKey(first).slice(0, 7)
}
