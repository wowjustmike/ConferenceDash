import { useMemo, useState } from 'react'
import { parseLocalDate } from '../lib/dates'
import { summarizeCities } from '../lib/compare'
import { size } from './ResultsList'
import type { ConfEvent, Topic } from '../lib/schema'

interface Props { events: ConfEvent[]; today: Date; onBack?: () => void }
const MAX = 3
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function CompareView({ events, today, onBack }: Props) {
  const active = useMemo(() => events.filter((e) => e.status === 'active'), [events])
  const cityList = useMemo(() => {
    const c = new Map<string, number>()
    for (const e of active) c.set(e.city, (c.get(e.city) ?? 0) + 1)
    return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [active])
  const [selected, setSelected] = useState<string[]>(() => cityList.slice(0, MAX).map(([c]) => c))
  const [topic, setTopic] = useState<Topic | 'all'>('all')
  const [msg, setMsg] = useState('')

  const topics = useMemo(() => {
    const c = new Map<Topic, number>()
    for (const e of active) for (const t of e.topics) c.set(t, (c.get(t) ?? 0) + 1)
    return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t)
  }, [active])
  const filtered = useMemo(() => (topic === 'all' ? active : active.filter((e) => e.topics.includes(topic))), [active, topic])
  const summary = useMemo(() => summarizeCities(filtered, selected, today), [filtered, selected, today])

  const toggle = (city: string) => {
    if (selected.includes(city)) { setSelected(selected.filter((c) => c !== city)); setMsg(''); return }
    if (selected.length >= MAX) { setMsg('Three cities max - remove one to swap'); return }
    setSelected([...selected, city]); setMsg('')
  }

  const start = new Date(today.getFullYear(), today.getMonth(), 1)
  const end = new Date(start.getFullYear() + 1, start.getMonth(), 1)
  const span = end.getTime() - start.getTime()
  const months = Array.from({ length: 12 }, (_, i) => MONTHS[(start.getMonth() + i) % 12] + (((start.getMonth() + i) % 12 === 0) ? ` ’${String(start.getFullYear() + Math.floor((start.getMonth() + i) / 12)).slice(2)}` : ''))
  const pct = (d: Date) => Math.max(0, Math.min(100, ((d.getTime() - start.getTime()) / span) * 100))

  return (
    <div className="compare">
      {onBack && <button className="link" onClick={onBack}>← Back to results</button>}
      <h1>Compare cities</h1>
      <p className="muted">Pick up to three cities. Bars share one timeline so busy weeks line up.</p>
      <div className="chip-grid" role="group" aria-label="Topic">
        <button className={`chip ${topic === 'all' ? 'active' : ''}`} aria-pressed={topic === 'all'} onClick={() => setTopic('all')}>All topics</button>
        {topics.map((t) => <button key={t} className={`chip ${topic === t ? 'active' : ''}`} aria-pressed={topic === t} onClick={() => setTopic(t)}>{t}</button>)}
      </div>
      <div className="cmp-cities" data-testid="city-picker">
        <strong className="muted">CITIES</strong>
        {cityList.map(([c, n]) => (
          <button key={c} className={`chip ${selected.includes(c) ? 'active' : ''}`} aria-pressed={selected.includes(c)} onClick={() => toggle(c)}>{c} {n}</button>
        ))}
        {msg && <span className="muted" role="status">{msg}</span>}
      </div>

      <div className="timeline">
        <div className="tl-row"><div className="tl-label" /><div className="tl-track"><div className="tl-months" style={{ ['--n' as string]: 12 }}>{months.map((m) => <div key={m}>{m}</div>)}</div></div></div>
        {summary.map((s) => {
          const evs = filtered.filter((e) => e.city === s.city && parseLocalDate(e.end_date) >= start && parseLocalDate(e.start_date) < end)
            .sort((a, b) => a.start_date.localeCompare(b.start_date))
          const laneEnds: number[] = []
          const bars = evs.map((e) => {
            const left = pct(parseLocalDate(e.start_date))
            const width = Math.max(pct(new Date(parseLocalDate(e.end_date).getTime() + 864e5)) - left, 9)
            let lane = laneEnds.findIndex((x) => x <= left)
            if (lane === -1) { lane = laneEnds.length; laneEnds.push(left + width) } else laneEnds[lane] = left + width
            return { e, left, width: Math.min(width, 100 - left), lane }
          })
          return (
            <div className="tl-row" key={s.city}>
              <div className="tl-label"><strong>{s.city}</strong><span className="muted">{s.count} events{s.attendees !== null && ` · ~${size(s.attendees)} attendees`}</span></div>
              <div className="tl-track" style={{ height: Math.max(laneEnds.length, 1) * 28 + 14 }}>
                {bars.map(({ e, left, width, lane }) => (
                  <div key={e.id} className={`tl-bar ${e.dates_confirmed ? '' : 'tbc'}`} title={e.name} style={{ left: `${left}%`, width: `${width}%`, top: 8 + lane * 28 }}>{e.name}</div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <h3 style={{ margin: '18px 0 6px' }}>At a glance</h3>
      <table className="glance" aria-label="At a glance">
        <thead><tr><th>City</th><th>Conferences</th><th>This spring</th><th>Est. attendees</th><th>Biggest event</th><th>Top topics</th></tr></thead>
        <tbody>
          {summary.map((s) => (
            <tr key={s.city}>
              <td><strong>{s.city}</strong></td><td>{s.count}</td><td>{s.spring}</td>
              <td>{s.attendees === null ? '—' : `~${size(s.attendees)}`}</td><td>{s.biggest ?? '—'}</td><td>{s.topTopics.join(', ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
