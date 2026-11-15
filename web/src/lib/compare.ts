import { overlaps } from './dates'
import type { ConfEvent, Topic } from './schema'

export interface CitySummary { city: string; count: number; spring: number; attendees: number | null; biggest: string | null; topTopics: Topic[] }

export function springWindow(today: Date): { from: Date; to: Date } {
  const y = today.getMonth() > 4 ? today.getFullYear() + 1 : today.getFullYear()
  return { from: new Date(y, 2, 1), to: new Date(y, 4, 31) }
}

export function summarizeCities(events: ConfEvent[], cities: string[], today: Date): CitySummary[] {
  const { from, to } = springWindow(today)
  return cities.map((city) => {
    const evs = events.filter((e) => e.status === 'active' && e.city === city)
    const known = evs.filter((e) => e.est_attendance !== null)
    const biggest = known.length ? known.reduce((a, b) => ((b.est_attendance ?? 0) > (a.est_attendance ?? 0) ? b : a)) : null
    const freq = new Map<Topic, number>()
    for (const e of evs) for (const t of e.topics) freq.set(t, (freq.get(t) ?? 0) + 1)
    const topTopics = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([t]) => t)
    return {
      city, count: evs.length, spring: evs.filter((e) => overlaps(e, from, to)).length,
      attendees: known.length ? known.reduce((n, e) => n + (e.est_attendance ?? 0), 0) : null,
      biggest: biggest?.name ?? null, topTopics,
    }
  })
}
