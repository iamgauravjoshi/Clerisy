export { fmtTime } from '@shared/format'

export const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

/** The full date and time, for tooltips next to a short date. */
export const fmtDateLong = (iso: string): string => new Date(iso).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })

/** An Electron accelerator as people read it: CommandOrControl+Shift+M → Ctrl+Shift+M. */
export const fmtAccelerator = (acc: string): string => acc.replace(/CommandOrControl|CmdOrCtrl/g, 'Ctrl')

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

/** "3 days ago", "yesterday", "in 2 hours": for summaries where the exact time matters less than how recent it is. */
export function fmtRelative(iso: string, now = Date.now()): string {
  const seconds = (new Date(iso).getTime() - now) / 1000
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60]
  ]
  for (const [unit, size] of units) if (Math.abs(seconds) >= size) return RELATIVE.format(Math.round(seconds / size), unit)
  return 'just now'
}

/** A calendar day as a heading: "Today", "Yesterday", or "Wed, Oct 8". */
export function fmtDay(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric'
  })
}
const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

/** Days from today until a YYYY-MM-DD due date: negative when overdue, null when there's no valid date. */
export function daysUntil(due: string, now = new Date()): number | null {
  const m = due.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return Math.round((new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() - startOfDay(now)) / 86400000)
}
