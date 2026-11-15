import { useMemo, useState } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, TileLayer } from 'react-leaflet'
import { formatRange } from '../lib/dates'
import { groupByCity } from '../lib/mapGroups'
import { size } from './ResultsList'
import type { ConfEvent } from '../lib/schema'

interface Props { events: ConfEvent[]; onSelect: (e: ConfEvent) => void }

function pinIcon(n: number, on: boolean) {
  const px = Math.min(30 + n * 2, 56)
  return L.divIcon({ className: '', iconSize: [px, px], html: `<div class="city-pin ${on ? 'on' : ''}" style="width:${px}px;height:${px}px">${n}</div>` })
}

export function MapView({ events, onSelect }: Props) {
  const { groups, unmapped } = useMemo(() => groupByCity(events), [events])
  const [key, setKey] = useState<string | null>(null)
  if (events.length === 0) return <p className="muted">No conferences to map with these filters.</p>
  const sel = groups.find((g) => g.key === key) ?? groups[0]
  return (
    <div>
      <p className="muted">{events.length - unmapped.length} conferences in {groups.length} metro areas{unmapped.length > 0 && ` · ${unmapped.length} unmapped`}</p>
      <div className="map-wrap">
        <MapContainer center={[39.5, -98.35]} zoom={4} scrollWheelZoom={false} className="map">
          <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {groups.map((g) => (
            <Marker key={g.key} position={g.coords} icon={pinIcon(g.events.length, g.key === sel?.key)} eventHandlers={{ click: () => setKey(g.key) }} />
          ))}
        </MapContainer>
        {sel && (
          <div className="panel" data-testid="map-panel">
            <small className="muted">SELECTED</small>
            <h2>{sel.label}</h2>
            <div className="kpis">
              <div className="kpi"><strong data-testid="kpi-count">{sel.events.length}</strong>conferences</div>
              <div className="kpi"><strong data-testid="kpi-attendees">{sel.attendees === null ? '—' : size(sel.attendees)}</strong>est. attendees</div>
            </div>
            {sel.events.map((e) => (
              <button key={e.id} className="row" onClick={() => onSelect(e)}>
                <span><strong>{e.name}</strong><br /><small className="muted">{formatRange(e.start_date, e.end_date)}{e.dates_confirmed ? '' : ' · Dates TBC'}</small></span>
                <span>{size(e.est_attendance)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
