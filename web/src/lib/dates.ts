export type Preset = 'next30' | 'quarter' | 'next12' | 'any' | 'custom'

export function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatRange(start: string, end: string): string {
  const s = parseLocalDate(start)
  const e = parseLocalDate(end)
  const sm = MONTHS[s.getMonth()]
  const em = MONTHS[e.getMonth()]
  if (start === end) return `${sm} ${s.getDate()}, ${s.getFullYear()}`
  if (s.getFullYear() !== e.getFullYear())
    return `${sm} ${s.getDate()}, ${s.getFullYear()} - ${em} ${e.getDate()}, ${e.getFullYear()}`
  if (s.getMonth() !== e.getMonth()) return `${sm} ${s.getDate()} - ${em} ${e.getDate()}, ${e.getFullYear()}`
  return `${sm} ${s.getDate()}-${e.getDate()}, ${e.getFullYear()}`
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

export function daysUntil(iso: string, today: Date): number {
  const ms = parseLocalDate(iso).getTime() - startOfDay(today).getTime()
  return Math.round(ms / 864e5)
}

export function presetRange(p: Preset, today: Date): { from: Date; to: Date } | null {
  const t = startOfDay(today)
  switch (p) {
    case 'next30':
      return { from: t, to: new Date(t.getFullYear(), t.getMonth(), t.getDate() + 30) }
    case 'quarter': {
      const qs = Math.floor(t.getMonth() / 3) * 3
      return { from: new Date(t.getFullYear(), qs, 1), to: new Date(t.getFullYear(), qs + 3, 0) }
    }
    case 'next12':
      return { from: t, to: new Date(t.getFullYear() + 1, t.getMonth(), t.getDate()) }
    default:
      return null
  }
}

export function overlaps(ev: { start_date: string; end_date: string }, from: Date, to: Date): boolean {
  return parseLocalDate(ev.start_date) <= to && parseLocalDate(ev.end_date) >= from
}
