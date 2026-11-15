import { overlaps, presetRange, type Preset } from './dates'
import type { ConfEvent, Topic } from './schema'

export type SizeBand = 'u10k' | '10-30k' | '30-75k' | '75k+'
export type SortBy = 'date' | 'name' | 'attendance'
export type Facet = 'state' | 'city' | 'venue' | 'topic'

export interface Filters {
  q: string
  preset: Preset
  from?: string
  to?: string
  states: string[]
  cities: string[]
  venues: string[]
  topics: Topic[]
  organizer: string
  sizes: SizeBand[]
}

export const EMPTY_FILTERS: Filters = {
  q: '', preset: 'next12', states: [], cities: [], venues: [], topics: [], organizer: '', sizes: [],
}

function inBand(n: number, b: SizeBand): boolean {
  switch (b) {
    case 'u10k': return n < 10000
    case '10-30k': return n >= 10000 && n < 30000
    case '30-75k': return n >= 30000 && n < 75000
    case '75k+': return n >= 75000
  }
}

function matches(e: ConfEvent, f: Filters, today: Date, skip?: Facet): boolean {
  if (e.status !== 'active') return false
  if (f.q) {
    const q = f.q.toLowerCase()
    if (![e.name, e.venue, e.organizer, e.city].some((s) => s.toLowerCase().includes(q))) return false
  }
  if (f.preset === 'custom') {
    if (f.from && f.to) {
      const [fy, fm, fd] = f.from.split('-').map(Number)
      const [ty, tm, td] = f.to.split('-').map(Number)
      if (!overlaps(e, new Date(fy, fm - 1, fd), new Date(ty, tm - 1, td))) return false
    }
  } else {
    const r = presetRange(f.preset, today)
    if (r && !overlaps(e, r.from, r.to)) return false
  }
  if (skip !== 'state' && f.states.length && !f.states.includes(e.state)) return false
  if (skip !== 'city' && f.cities.length && !f.cities.includes(e.city)) return false
  if (skip !== 'venue' && f.venues.length && !f.venues.includes(e.venue)) return false
  if (skip !== 'topic' && f.topics.length && !e.topics.some((t) => f.topics.includes(t))) return false
  if (f.organizer && !e.organizer.toLowerCase().includes(f.organizer.toLowerCase())) return false
  if (f.sizes.length) {
    if (e.est_attendance === null) return false
    const n = e.est_attendance
    if (!f.sizes.some((b) => inBand(n, b))) return false
  }
  return true
}

export function applyFilters(events: ConfEvent[], f: Filters, today: Date): ConfEvent[] {
  return events.filter((e) => matches(e, f, today))
}

export function facetCounts(events: ConfEvent[], f: Filters, today: Date, facet: Facet): Map<string, number> {
  const counts = new Map<string, number>()
  for (const e of events) {
    if (!matches(e, f, today, facet)) continue
    const keys = facet === 'state' ? [e.state] : facet === 'city' ? [e.city] : facet === 'venue' ? [e.venue] : e.topics
    for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return counts
}

export function citiesForStates(events: ConfEvent[], states: string[]): string[] {
  const set = new Set<string>()
  for (const e of events) if (!states.length || states.includes(e.state)) set.add(e.city)
  return [...set].sort()
}

export function sortEvents(events: ConfEvent[], by: SortBy): ConfEvent[] {
  const l = [...events]
  if (by === 'name') return l.sort((a, b) => a.name.localeCompare(b.name))
  if (by === 'attendance')
    return l.sort((a, b) => (b.est_attendance ?? -1) - (a.est_attendance ?? -1) || a.start_date.localeCompare(b.start_date))
  return l.sort((a, b) => a.start_date.localeCompare(b.start_date) || a.name.localeCompare(b.name))
}
