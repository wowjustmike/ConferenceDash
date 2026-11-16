import { formatRange } from '../lib/dates'
import { Bars, VerifiedBadge, size, stateAbbr } from './ResultsList'
import { isSample } from '../lib/sample'
import type { ConfEvent } from '../lib/schema'

interface Props { events: ConfEvent[]; today: Date; onSelect: (e: ConfEvent) => void }

export function ResultCards({ events, today, onSelect }: Props) {
  return (
    <div className="cards">
      {events.map((e) => (
        <div key={e.id} data-testid="event-card" className="card" role="button" tabIndex={0}
          onClick={() => onSelect(e)} onKeyDown={(k) => { if (k.key === 'Enter') onSelect(e) }}>
          <div className="top"><span>{e.name}</span><span>{size(e.est_attendance)}</span></div>
          <div className="meta">{formatRange(e.start_date, e.end_date)} · {e.city}, {stateAbbr(e.state)}<br />{e.venue} · {e.organizer}</div>
          <div className="bottom">
            {e.topics.map((t) => <span key={t} className="tag">{t}</span>)}
            {isSample(e) && <span className="tag sample">Sample</span>}
            <Bars ev={e} />
            <VerifiedBadge ev={e} today={today} />
            <a style={{ marginLeft: 'auto' }} href={e.official_url} target="_blank" rel="noopener noreferrer" onClick={(k) => k.stopPropagation()}>Site ↗</a>
          </div>
        </div>
      ))}
    </div>
  )
}
