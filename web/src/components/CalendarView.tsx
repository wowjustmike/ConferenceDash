import { useMemo } from 'react'
import { formatRange, overlaps } from '../lib/dates'
import { weekRows } from '../lib/calendar'
import { size, stateAbbr } from './ResultsList'
import type { ConfEvent } from '../lib/schema'

interface Props { events: ConfEvent[]; month: Date; onMonthChange: (m: Date) => void; onSelect: (e: ConfEvent) => void; selectedId?: string }

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function CalendarView({ events, month, onMonthChange, onSelect, selectedId }: Props) {
  const y = month.getFullYear()
  const m = month.getMonth()
  const rows = useMemo(() => weekRows(events, y, m), [events, y, m])
  const inMonth = useMemo(
    () => events.filter((e) => overlaps(e, new Date(y, m, 1), new Date(y, m + 1, 0))).sort((a, b) => a.start_date.localeCompare(b.start_date)),
    [events, y, m],
  )
  const title = month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  return (
    <div className="cal-wrap">
      <div>
        <div className="cal-head">
          <button className="btn icon" aria-label="Previous month" onClick={() => onMonthChange(new Date(y, m - 1, 1))}>‹</button>
          <button className="btn icon" aria-label="Next month" onClick={() => onMonthChange(new Date(y, m + 1, 1))}>›</button>
          <h2>{title}</h2><span className="muted">{inMonth.length} conferences</span>
        </div>
        <div className="cal">
          <div className="cal-dow">{DOW.map((d) => <div key={d}>{d}</div>)}</div>
          {rows.map((r, i) => (
            <div key={i} className="cal-week" style={{ gridTemplateRows: `28px repeat(${Math.max(r.lanes, 1)}, 26px) minmax(0, 1fr)` }}>
              {r.days.map((d, c) => (
                <div key={c} className={`cal-day ${d.getMonth() === m ? 'in' : ''}`} style={{ gridColumn: c + 1, gridRow: `1 / ${Math.max(r.lanes, 1) + 3}` }}>{d.getDate()}</div>
              ))}
              {r.segments.map((s) => (
                <button
                  key={s.event.id} data-testid="cal-bar" onClick={() => onSelect(s.event)}
                  className={`cal-bar ${s.event.dates_confirmed ? '' : 'tbc'} ${s.event.id === selectedId ? 'sel' : ''}`}
                  style={{ gridColumn: `${s.startCol + 1} / ${s.endCol + 2}`, gridRow: s.lane + 2 }}
                >
                  {s.continuesLeft ? '… ' : ''}{s.event.name} · {s.event.city}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="legend" style={{ marginLeft: 0, marginTop: 8 }}>
          <span><i className="dot fresh" /> Confirmed dates</span><span className="badge tbc">Dates TBC</span>
        </div>
      </div>
      <div className="agenda">
        <h3>Agenda · {title}</h3>
        {inMonth.length === 0 && <p className="muted">No conferences this month.</p>}
        {inMonth.map((e) => (
          <button key={e.id} data-testid="agenda-item" className="agenda-item" onClick={() => onSelect(e)}>
            <strong>{e.name}</strong> {!e.dates_confirmed && <span className="badge tbc">TBC</span>}
            <small>{formatRange(e.start_date, e.end_date)} · {e.city}, {stateAbbr(e.state)}</small>
            <small>{e.venue} · {e.est_attendance === null ? 'Attendance n/a' : `${size(e.est_attendance)} expected`}</small>
          </button>
        ))}
      </div>
    </div>
  )
}
