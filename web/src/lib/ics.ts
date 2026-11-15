import { parseLocalDate } from './dates'
import type { ConfEvent } from './schema'

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')

export function buildIcs(e: ConfEvent): string {
  const start = parseLocalDate(e.start_date)
  const endExclusive = parseLocalDate(e.end_date)
  endExclusive.setDate(endExclusive.getDate() + 1)
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ConferenceDash//EN', 'BEGIN:VEVENT',
    `UID:${e.id}@conferencedash`, `DTSTAMP:${ymd(new Date())}T000000Z`,
    `DTSTART;VALUE=DATE:${ymd(start)}`, `DTEND;VALUE=DATE:${ymd(endExclusive)}`,
    `SUMMARY:${esc(e.name)}`, `LOCATION:${esc(`${e.venue}, ${e.city}, ${e.state}`)}`, `URL:${e.official_url}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n')
}

export function downloadIcs(e: ConfEvent): void {
  const url = URL.createObjectURL(new Blob([buildIcs(e)], { type: 'text/calendar' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${e.id}.ics`
  a.click()
  URL.revokeObjectURL(url)
}
