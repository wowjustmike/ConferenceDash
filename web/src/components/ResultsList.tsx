import { formatRange, startLabel } from '../lib/dates'
import { badgesFor } from '../lib/badges'
import type { SortBy } from '../lib/filters'
import { isSample } from '../lib/sample'
import { signalFor } from '../lib/signal'
import { SignalBars } from './SignalBars'
import type { ConfEvent } from '../lib/schema'

interface Props { events: ConfEvent[]; today: Date; sort: SortBy; onSort: (s: SortBy) => void; onSelect: (e: ConfEvent) => void; selectedId?: string }

export function size(n: number | null): string {
  if (n === null) return '—'
  return n >= 1000 ? `${Math.round(n / 1000)}K` : String(n)
}

export function Bars({ ev }: { ev: ConfEvent }) {
  const s = signalFor(ev)
  return <SignalBars bars={s.bars} evidence={s.evidence} flags={s.flags} />
}

export function VerifiedBadge({ ev, today }: { ev: ConfEvent; today: Date }) {
  const b = badgesFor(ev, today)
  const label = b.ageDays <= 0 ? 'Today' : `${b.ageDays}d ago`
  return (
    <>
      {b.tbc && <span className="badge tbc">Dates TBC</span>}
      <span className={`dot ${b.verified}`} title={b.verified === 'due' ? 'Re-check due' : 'Verified'} />
      <span className="muted">{label}</span>
    </>
  )
}

export function ResultsList({ events, today, sort, onSort, onSelect, selectedId }: Props) {
  return (
    <div>
      <div className="sortbar">
        <span className="muted">Sort by</span>
        <div className="seg">
          {(['date', 'name', 'attendance', 'signal'] as SortBy[]).map((s) => (
            <button key={s} className={sort === s ? 'on' : ''} aria-pressed={sort === s} onClick={() => onSort(s)}>
              {s === 'date' ? 'Date' : s === 'name' ? 'Name' : s === 'attendance' ? 'Attendance' : 'Signal'}
            </button>
          ))}
        </div>
        <div className="legend">
          <span><i className="dot fresh" /> Verified ≤ 30 days</span>
          <span><i className="dot due" /> Re-check due</span>
          <span className="badge tbc">Dates TBC</span><span className="muted">Not confirmed by organizer</span>
        </div>
      </div>
      <table className="results">
        <thead><tr><th>Event</th><th>Dates</th><th>Location</th><th>Organizer</th><th className="num">Est. size</th><th>Verified</th><th /></tr></thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id} data-testid="event-row" className={e.id === selectedId ? 'selected' : ''} onClick={() => onSelect(e)}>
              <td>
                <button className="name" onClick={(ev) => { ev.stopPropagation(); onSelect(e) }}>{e.name}</button>
                <div className="tags">{e.topics.map((t) => <span key={t} className="tag">{t}</span>)}{isSample(e) && <span className="tag sample" title="Placeholder data">Sample</span>}</div>
              </td>
              <td><strong>{formatRange(e.start_date, e.end_date)}</strong>
                <div className="muted">{startLabel(e, today)}</div></td>
              <td><strong>{e.city}, {stateAbbr(e.state)}</strong><div className="muted">{e.venue}</div></td>
              <td>{e.organizer}</td>
              <td className="num"><strong>{size(e.est_attendance)}</strong></td>
              <td className="ver"><Bars ev={e} /> <VerifiedBadge ev={e} today={today} /></td>
              <td><a href={e.official_url} target="_blank" rel="noopener noreferrer" onClick={(ev) => ev.stopPropagation()}>Official site ↗</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const ABBR: Record<string, string> = {
  Nevada: 'NV', California: 'CA', Texas: 'TX', Florida: 'FL', Illinois: 'IL', 'New York': 'NY', Georgia: 'GA', Arizona: 'AZ',
  Colorado: 'CO', Washington: 'WA', Massachusetts: 'MA', Tennessee: 'TN', Louisiana: 'LA', Oregon: 'OR', Utah: 'UT',
}
export function stateAbbr(s: string): string { return ABBR[s] ?? s }
