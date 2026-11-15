import { useMemo, useState } from 'react'
import { EMPTY_FILTERS, citiesForStates, facetCounts, type Filters, type SizeBand } from '../lib/filters'
import { TOPICS, type ConfEvent, type Topic } from '../lib/schema'
import type { Preset } from '../lib/dates'

interface Props { events: ConfEvent[]; filters: Filters; onChange: (f: Filters) => void; today: Date }

const PRESETS: [Preset, string][] = [['next30', 'Next 30 days'], ['quarter', 'This quarter'], ['next12', 'Next 12 months'], ['any', 'Any date']]
const SIZES: [SizeBand, string][] = [['u10k', 'Under 10K'], ['10-30k', '10–30K'], ['30-75k', '30–75K'], ['75k+', '75K+']]
const INITIAL_STATES = 4

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
}

export function FilterSidebar({ events, filters: f, onChange, today }: Props) {
  const [allStates, setAllStates] = useState(false)
  const [venueQ, setVenueQ] = useState('')
  const stateCounts = useMemo(() => facetCounts(events, f, today, 'state'), [events, f, today])
  const cityCounts = useMemo(() => facetCounts(events, f, today, 'city'), [events, f, today])
  const venueCounts = useMemo(() => facetCounts(events, f, today, 'venue'), [events, f, today])
  const topicCounts = useMemo(() => facetCounts(events, f, today, 'topic'), [events, f, today])

  const states = useMemo(() => {
    const names = [...new Set(events.map((e) => e.state))]
    return names.sort((a, b) => (stateCounts.get(b) ?? 0) - (stateCounts.get(a) ?? 0) || a.localeCompare(b))
  }, [events, stateCounts])
  const shownStates = allStates ? states : states.slice(0, INITIAL_STATES)
  const cities = citiesForStates(events, f.states)
  const venues = useMemo(() => {
    const names = [...new Set(events.filter((e) => !f.states.length || f.states.includes(e.state)).map((e) => e.venue))]
    return names
      .filter((v) => v.toLowerCase().includes(venueQ.toLowerCase()))
      .sort((a, b) => (venueCounts.get(b) ?? 0) - (venueCounts.get(a) ?? 0) || a.localeCompare(b))
      .slice(0, 8)
  }, [events, f.states, venueQ, venueCounts])

  return (
    <aside className="sidebar" aria-label="Filters">
      <div className="side-head"><h2>Filters</h2><button className="link" onClick={() => onChange(EMPTY_FILTERS)}>Reset</button></div>

      <section><h3>Date range</h3>
        <div className="chip-grid">
          {PRESETS.map(([p, label]) => (
            <button key={p} className={`chip ${f.preset === p ? 'active' : ''}`} aria-pressed={f.preset === p}
              onClick={() => onChange({ ...f, preset: p, from: undefined, to: undefined })}>{label}</button>
          ))}
        </div>
        <div className="custom-range">
          <label>From <input type="date" value={f.from ?? ''} onChange={(e) => onChange({ ...f, preset: 'custom', from: e.target.value, to: f.to ?? e.target.value })} /></label>
          <label>To <input type="date" value={f.to ?? ''} onChange={(e) => onChange({ ...f, preset: 'custom', to: e.target.value, from: f.from ?? e.target.value })} /></label>
        </div>
      </section>

      <section data-testid="facet-state"><h3>State</h3>
        {shownStates.map((s) => (
          <label key={s} className="check">
            <input type="checkbox" checked={f.states.includes(s)} onChange={() => onChange({ ...f, states: toggle(f.states, s), cities: [] })} />
            <span>{s}</span><span className="count">{stateCounts.get(s) ?? 0}</span>
          </label>
        ))}
        {states.length > INITIAL_STATES && (
          <button className="link" onClick={() => setAllStates(!allStates)}>
            {allStates ? 'Show fewer states' : `Show all ${states.length} states`}
          </button>
        )}
      </section>

      <section data-testid="facet-city"><h3>City {f.states.length > 0 && <small>In {f.states.length} selected state{f.states.length > 1 ? 's' : ''}</small>}</h3>
        {cities.map((c) => (
          <label key={c} className="check">
            <input type="checkbox" checked={f.cities.includes(c)} onChange={() => onChange({ ...f, cities: toggle(f.cities, c) })} />
            <span>{c}</span><span className="count">{cityCounts.get(c) ?? 0}</span>
          </label>
        ))}
      </section>

      <section><h3>Venue</h3>
        <input className="field" placeholder="Search venues" aria-label="Search venues" value={venueQ} onChange={(e) => setVenueQ(e.target.value)} />
        {venues.map((v) => (
          <label key={v} className="check">
            <input type="checkbox" checked={f.venues.includes(v)} onChange={() => onChange({ ...f, venues: toggle(f.venues, v) })} />
            <span>{v}</span><span className="count">{venueCounts.get(v) ?? 0}</span>
          </label>
        ))}
      </section>

      <section><h3>Topic or industry</h3>
        <div className="chip-grid">
          {TOPICS.filter((t) => t !== 'Other' || topicCounts.has('Other')).map((t: Topic) => (
            <button key={t} className={`chip ${f.topics.includes(t) ? 'active' : ''}`} aria-pressed={f.topics.includes(t)}
              onClick={() => onChange({ ...f, topics: toggle(f.topics, t) })}>{t}</button>
          ))}
        </div>
      </section>

      <section><h3>Organizer</h3>
        <input className="field" placeholder="e.g. Informa, CTA, SXSW" aria-label="Organizer" value={f.organizer} onChange={(e) => onChange({ ...f, organizer: e.target.value })} />
      </section>

      <section><h3>Expected attendance</h3>
        <div className="chip-grid">
          {SIZES.map(([s, label]) => (
            <button key={s} className={`chip ${f.sizes.includes(s) ? 'active' : ''}`} aria-pressed={f.sizes.includes(s)}
              onClick={() => onChange({ ...f, sizes: toggle(f.sizes, s) })}>{label}</button>
          ))}
        </div>
      </section>
    </aside>
  )
}
