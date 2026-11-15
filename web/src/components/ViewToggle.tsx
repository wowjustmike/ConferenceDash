export type View = 'list' | 'calendar' | 'map' | 'compare'
export const VIEWS: View[] = ['list', 'calendar', 'map', 'compare']

export function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const items: [View, string][] = [['list', 'List'], ['calendar', 'Calendar'], ['map', 'Map']]
  return (
    <div className="seg" role="group" aria-label="View">
      {items.map(([v, label]) => (
        <button key={v} className={view === v ? 'on' : ''} aria-pressed={view === v} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  )
}
