import { applyFilters, EMPTY_FILTERS, type Filters } from '../lib/filters'
import { activeFilterCount } from './ActiveChips'
import type { ConfEvent } from '../lib/schema'

interface Props { events: ConfEvent[]; filters: Filters; today: Date; onChange: (f: Filters) => void }

const DROPS: { label: string; apply: (f: Filters) => Filters; active: (f: Filters) => boolean }[] = [
  { label: 'search text', apply: (f) => ({ ...f, q: '' }), active: (f) => !!f.q },
  { label: 'date range', apply: (f) => ({ ...f, preset: 'any', from: undefined, to: undefined }), active: (f) => f.preset !== 'any' },
  { label: 'state', apply: (f) => ({ ...f, states: [], cities: [] }), active: (f) => f.states.length > 0 },
  { label: 'city', apply: (f) => ({ ...f, cities: [] }), active: (f) => f.cities.length > 0 },
  { label: 'venue', apply: (f) => ({ ...f, venues: [] }), active: (f) => f.venues.length > 0 },
  { label: 'topic', apply: (f) => ({ ...f, topics: [] }), active: (f) => f.topics.length > 0 },
  { label: 'organizer', apply: (f) => ({ ...f, organizer: '' }), active: (f) => !!f.organizer },
  { label: 'signal', apply: (f) => ({ ...f, minSignal: 1 }), active: (f) => f.minSignal > 1 },
  { label: 'attendance', apply: (f) => ({ ...f, sizes: [] }), active: (f) => f.sizes.length > 0 },
]

export function EmptyState({ events, filters, today, onChange }: Props) {
  const suggestions = DROPS.filter((d) => d.active(filters))
    .map((d) => ({ label: d.label, next: d.apply(filters), n: applyFilters(events, d.apply(filters), today).length }))
    .filter((s) => s.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 3)
  const n = activeFilterCount(filters)
  return (
    <div className="empty">
      <div>
        <h3>No conferences match these filters</h3>
        <p className="muted">{n > 1 ? `${n} filters together leave nothing.` : 'Nothing matches.'} Loosen one of them, or start over.</p>
        <button className="btn" onClick={() => onChange(EMPTY_FILTERS)}>Clear all</button>
        <a className="btn primary-outline" href="mailto:?subject=ConferenceDash%20event%20submission">Know one we’re missing? Submit it</a>
      </div>
      <div>
        <h4>Closest matches</h4>
        {suggestions.map((s) => (
          <button key={s.label} data-testid="suggestion" className="suggest" onClick={() => onChange(s.next)}>
            <span>Without the {s.label} filter</span><strong>{s.n} results</strong>
          </button>
        ))}
      </div>
    </div>
  )
}
