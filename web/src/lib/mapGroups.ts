import { coordsFor } from './geo'
import type { ConfEvent } from './schema'

export interface CityGroup { key: string; city: string; state: string; label: string; coords: [number, number]; events: ConfEvent[]; attendees: number | null }

// Cities that should roll up into a neighbouring metro pin.
const METRO_OF: Record<string, string> = { 'Anaheim, California': 'Los Angeles, California' }

export function groupByCity(events: ConfEvent[]): { groups: CityGroup[]; unmapped: ConfEvent[] } {
  const map = new Map<string, { events: ConfEvent[]; cities: Set<string> }>()
  const unmapped: ConfEvent[] = []
  for (const e of events) {
    const own = `${e.city}, ${e.state}`
    const key = METRO_OF[own] ?? own
    const [city, state] = key.split(', ')
    if (!coordsFor(city, state)) { unmapped.push(e); continue }
    const g = map.get(key) ?? { events: [], cities: new Set<string>() }
    g.events.push(e)
    g.cities.add(e.city)
    map.set(key, g)
  }
  const groups = [...map.entries()].map(([key, g]) => {
    const [city, state] = key.split(', ')
    const known = g.events.filter((e) => e.est_attendance !== null)
    return {
      key, city, state, label: g.cities.size > 1 ? `${city} area` : city, coords: coordsFor(city, state)!,
      events: [...g.events].sort((a, b) => a.start_date.localeCompare(b.start_date)),
      attendees: known.length ? known.reduce((n, e) => n + (e.est_attendance ?? 0), 0) : null,
    }
  })
  groups.sort((a, b) => b.events.length - a.events.length || a.label.localeCompare(b.label))
  return { groups, unmapped }
}
