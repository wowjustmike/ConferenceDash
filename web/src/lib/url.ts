import { EMPTY_FILTERS, type Filters, type SizeBand } from './filters'
import type { Preset } from './dates'
import { TOPICS, type Topic } from './schema'

const PRESETS: Preset[] = ['next30', 'quarter', 'next12', 'any', 'custom']
const SIZES: SizeBand[] = ['u10k', '10-30k', '30-75k', '75k+']
// Lists are encoded as repeated params so values may contain commas.
const LISTS = ['states', 'cities', 'venues', 'topics', 'sizes'] as const

export function filtersToParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams()
  if (f.q) p.set('q', f.q)
  if (f.preset !== EMPTY_FILTERS.preset) p.set('preset', f.preset)
  if (f.preset === 'custom') {
    if (f.from) p.set('from', f.from)
    if (f.to) p.set('to', f.to)
  }
  for (const k of LISTS) for (const v of f[k]) p.append(k, v)
  if (f.organizer) p.set('organizer', f.organizer)
  if (f.minSignal > 1) p.set('signal', String(f.minSignal))
  return p
}

export function paramsToFilters(p: URLSearchParams): Filters {
  const preset = p.get('preset') as Preset | null
  return {
    q: p.get('q') ?? '',
    preset: preset && PRESETS.includes(preset) ? preset : EMPTY_FILTERS.preset,
    ...(p.get('from') ? { from: p.get('from')! } : {}),
    ...(p.get('to') ? { to: p.get('to')! } : {}),
    states: p.getAll('states'),
    cities: p.getAll('cities'),
    venues: p.getAll('venues'),
    topics: p.getAll('topics').filter((t): t is Topic => (TOPICS as readonly string[]).includes(t)),
    organizer: p.get('organizer') ?? '',
    sizes: p.getAll('sizes').filter((s): s is SizeBand => (SIZES as string[]).includes(s)),
    minSignal: ({ '2': 2, '3': 3 } as Record<string, 2 | 3>)[p.get('signal') ?? ''] ?? 1,
  }
}
