import { useEffect } from 'react'
import { daysUntil, formatRange, parseLocalDate } from '../lib/dates'
import { downloadIcs } from '../lib/ics'
import { VerifiedBadge, size } from './ResultsList'
import type { ConfEvent } from '../lib/schema'

interface Props { event: ConfEvent; events: ConfEvent[]; today: Date; onClose: () => void; onSelect: (e: ConfEvent) => void }

export function EventDrawer({ event: e, events, today, onClose, onSelect }: Props) {
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const horizon = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate())
  const upcoming = events.filter((x) => x.status === 'active' && x.id !== e.id && parseLocalDate(x.start_date) <= horizon)
  const atVenue = upcoming.filter((x) => x.venue === e.venue)
  const byOrganizer = upcoming.filter((x) => x.organizer === e.organizer)
  const d = daysUntil(e.start_date, today)

  const Related = ({ list, testid }: { list: ConfEvent[]; testid: string }) => (
    <div data-testid={testid}>
      {list.map((x) => (
        <button key={x.id} className="related" onClick={() => onSelect(x)}>
          <span>{x.name}</span><span className="muted">{formatRange(x.start_date, x.end_date)}</span>
        </button>
      ))}
    </div>
  )

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={e.name}>
        <div className="drawer-top">
          <div className="tags">{e.topics.map((t) => <span key={t} className="tag">{t}</span>)}</div>
          <button className="btn icon" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <h2>{e.name}</h2>
        <p className="muted">{formatRange(e.start_date, e.end_date)} · {e.city}, {e.state}</p>
        <div className="actions">
          <a className="btn primary" href={e.official_url} target="_blank" rel="noopener noreferrer">Visit official site ↗</a>
          <button className="btn" onClick={() => downloadIcs(e)}>Add to calendar</button>
        </div>
        <dl>
          <dt>Dates</dt><dd><strong>{formatRange(e.start_date, e.end_date)}</strong> <span className="muted">{d > 0 ? `· In ${d} days` : '· Now'}</span>{!e.dates_confirmed && <> <span className="badge tbc">Dates TBC</span></>}</dd>
          <dt>City</dt><dd>{e.city}, {e.state}</dd>
          <dt>Venue</dt><dd>{e.venue}</dd>
          <dt>Organizer</dt><dd>{e.organizer}</dd>
          <dt>Expected attendance</dt><dd>{e.est_attendance === null ? '—' : `~${e.est_attendance.toLocaleString('en-US')} attendees`}</dd>
          <dt>Last verified</dt><dd><VerifiedBadge ev={e} today={today} /></dd>
        </dl>
        <h4>More at {e.venue}</h4>
        {atVenue.length ? <Related list={atVenue} testid="related-venue" /> : <p className="muted">No other events at this venue in the next 12 months.</p>}
        <h4>More from {e.organizer}</h4>
        {byOrganizer.length ? <Related list={byOrganizer} testid="related-organizer" /> : <p className="muted">No other events from this organizer in the next 12 months.</p>}
      </aside>
    </>
  )
}

export { size }
