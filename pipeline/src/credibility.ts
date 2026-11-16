import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { z } from 'zod'

export type EvidenceKind = 'official-site' | 'ticketing' | 'venue-calendar' | 'directory' | 'aggregator' | 'seed'
export interface Evidence { family: string; kind: EvidenceKind; confirmsEdition: boolean; seenAt: string; label: string }
export interface SignalEvidence { label: string; family: string; kind: EvidenceKind; points: number; seenAt: string }
export interface Signal { points: number; bars: 1 | 2 | 3; evidence: SignalEvidence[]; flags: ('conflicting-dates' | 'stale')[] }

const Config = z.object({
  points: z.object({ 'official-site': z.number(), ticketing: z.number(), 'venue-calendar': z.number(), directory: z.number(), aggregator: z.number(), seed: z.number() }),
  penalties: z.object({ conflicting_dates: z.number(), stale: z.number() }),
  stale_days: z.number(),
  families: z.record(z.string(), z.array(z.string())),
})
export type Credibility = z.infer<typeof Config>

const DEFAULT_PATH = new URL('../sources/credibility.yaml', import.meta.url)

export function loadCredibility(path?: string | URL): Credibility {
  const r = Config.safeParse(parse(readFileSync(path ?? DEFAULT_PATH, 'utf8')))
  if (!r.success) throw new Error(`Invalid credibility config: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  return r.data
}

const stripWww = (h: string) => h.toLowerCase().replace(/^www\./, '')

export function familyOf(host: string, c: Credibility): string {
  const h = stripWww(host)
  for (const [family, hosts] of Object.entries(c.families)) if (hosts.some((x) => h === x || h.endsWith(`.${x}`))) return family
  return h
}

// Only an organizer-site check must confirm THIS edition. A dated ticketing listing (e.g. Ticketmaster) is for a specific upcoming date, so it counts for its own edition.
const POINT_KINDS = new Set<EvidenceKind>(['official-site'])

export function scoreSignal(evidence: Evidence[], opts: { conflictingDates: boolean; today: Date; c?: Credibility }): Signal {
  const c = opts.c ?? loadCredibility()
  const best = new Map<string, { e: Evidence; points: number }>()
  for (const e of evidence) {
    // Official/ticketing pages only count when they confirm THIS edition (not last year's page).
    const points = POINT_KINDS.has(e.kind) && !e.confirmsEdition ? 0 : c.points[e.kind]
    const cur = best.get(e.family)
    if (!cur || points > cur.points) best.set(e.family, { e, points })
  }
  let points = [...best.values()].reduce((n, x) => n + x.points, 0)
  const flags: Signal['flags'] = []
  if (opts.conflictingDates) { points -= c.penalties.conflicting_dates; flags.push('conflicting-dates') }
  const real = evidence.filter((e) => e.kind !== 'seed')
  if (real.length > 0) {
    const newest = Math.max(...real.map((e) => new Date(e.seenAt).getTime()))
    if ((opts.today.getTime() - newest) / 864e5 > c.stale_days) { points -= c.penalties.stale; flags.push('stale') }
  }
  points = Math.max(0, points)
  return {
    points, bars: points >= 3 ? 3 : points === 2 ? 2 : 1, flags,
    evidence: [...best.values()].map(({ e, points: p }) => ({ label: e.label, family: e.family, kind: e.kind, points: p, seenAt: e.seenAt })),
  }
}
