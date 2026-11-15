import { EMPTY_FILTERS, type Filters } from '../lib/filters'

const PRESET_LABEL: Record<string, string> = {
  next30: 'Next 30 days', quarter: 'This quarter', next12: 'Next 12 months', any: 'Any date', custom: 'Custom dates',
}

interface Props { filters: Filters; onChange: (f: Filters) => void }

export function activeFilterCount(f: Filters): number {
  return (
    f.states.length + f.cities.length + f.venues.length + f.topics.length + f.sizes.length +
    (f.q ? 1 : 0) + (f.organizer ? 1 : 0) + (f.preset !== EMPTY_FILTERS.preset ? 1 : 0)
  )
}

export function ActiveChips({ filters: f, onChange }: Props) {
  const chips: { key: string; label: string; remove: () => void }[] = []
  const list = <K extends 'states' | 'cities' | 'venues' | 'topics' | 'sizes'>(k: K) =>
    (f[k] as string[]).forEach((v) =>
      chips.push({ key: `${k}:${v}`, label: v, remove: () => onChange({ ...f, [k]: (f[k] as string[]).filter((x) => x !== v) }) }),
    )
  list('states'); list('cities'); list('venues'); list('topics'); list('sizes')
  if (f.preset !== EMPTY_FILTERS.preset)
    chips.push({ key: 'preset', label: PRESET_LABEL[f.preset], remove: () => onChange({ ...f, preset: EMPTY_FILTERS.preset, from: undefined, to: undefined }) })
  if (f.q) chips.push({ key: 'q', label: `“${f.q}”`, remove: () => onChange({ ...f, q: '' }) })
  if (f.organizer) chips.push({ key: 'org', label: f.organizer, remove: () => onChange({ ...f, organizer: '' }) })
  return (
    <div className="chips" data-testid="active-chips">
      {chips.map((c) => (
        <span key={c.key} className="chip active">
          {c.label}
          <button aria-label={`Remove ${c.label}`} onClick={c.remove}>×</button>
        </span>
      ))}
      {chips.length > 0 && (
        <button className="link" onClick={() => onChange(EMPTY_FILTERS)}>Clear all</button>
      )}
    </div>
  )
}

export { PRESET_LABEL }
