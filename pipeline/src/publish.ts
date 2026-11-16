import { renameSync, writeFileSync } from 'node:fs'
import { EventSchema, TOPICS, type ConfEvent } from '../../web/src/lib/schema'
import { config } from './config'
import { looksSame, matchKey, type MergedEvent } from './dedupe'
import { guessTopics } from './normalize'
import { confidence } from './score'
import type { Candidate } from './types'
import type { Verification } from './verify'

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** Stable across name variants ("CES", "International CES 2027"): derived from the dedupe key. */
export function eventId(c: Candidate): string {
  const [name, year, city] = matchKey(c).split('|')
  return slug(`${name}-${year}-${city}`)
}

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const asCandidate = (e: ConfEvent): Candidate => ({ name: e.name, start_date: e.start_date, end_date: e.end_date, city: e.city, state: e.state, official_url: e.official_url, source: { url: e.official_url, type: 'jsonld', fetched_at: e.last_verified } })

/** Existing event id for the same real-world event (so an id never changes because a different name won this run). */
export function reuseId(c: Candidate, existing: ConfEvent[]): string | null {
  return existing.find((e) => looksSame(c, asCandidate(e)))?.id ?? null
}

export function toConfEvent(m: MergedEvent, v: Verification | undefined, today: Date, idOverride?: string | null): ConfEvent | null {
  const c = m.candidate
  if (!c.start_date || !c.end_date || !c.city || !c.state || !c.official_url) return null
  const earliestFetch = m.sources.map((s) => s.fetched_at.slice(0, 10)).sort()[0] ?? isoDay(today)
  const age = Math.max(0, Math.round((today.getTime() - new Date(earliestFetch).getTime()) / 864e5))
  const ev = {
    id: idOverride ?? eventId(c), name: c.name, start_date: c.start_date, end_date: c.end_date, dates_confirmed: v?.reachable === true && v.datesConfirmed && !v.cancelled,
    city: c.city, state: c.state, venue: c.venue ?? '', organizer: c.organizer ?? '',
    topics: (c.topics?.length ? c.topics : guessTopics(c.name)).filter((t) => (TOPICS as readonly string[]).includes(t)),
    est_attendance: c.est_attendance ?? null, official_url: c.official_url, sources: m.sources,
    last_verified: v?.reachable ? isoDay(today) : earliestFetch,
    confidence: confidence({ verification: v, agreeingSources: m.agreeing, hasOfficialUrl: true, conflictingDates: m.conflictingDates, ageDays: v?.reachable ? 0 : age }),
    status: v?.cancelled ? 'cancelled' : 'active',
  }
  const r = EventSchema.safeParse(ev)
  return r.success ? r.data : null
}

export interface MergeOpts { today: Date; healthy: boolean; dropSeed?: 'matched' | 'all' | 'none' }
const MAX_SOURCES = 10

export function mergeIntoExisting(existing: ConfEvent[], fresh: ConfEvent[], opts: MergeOpts): { events: ConfEvent[]; quarantined: ConfEvent[]; archived: number } {
  const quarantined: ConfEvent[] = []
  const byId = new Map(existing.map((e) => [e.id, e]))
  let published = 0
  if (opts.healthy) {
    for (const f of fresh) {
      if (f.status === 'cancelled') {
        // A cancellation found on the official site is applied even though such records score low; never published as new.
        const e = byId.get(f.id)
        if (e) byId.set(e.id, { ...e, status: 'cancelled', last_verified: f.last_verified > e.last_verified ? f.last_verified : e.last_verified })
        continue
      }
      if (f.confidence < config.publishThreshold) { quarantined.push(f); continue }
      published++
      const e = byId.get(f.id)
      if (!e) { byId.set(f.id, f); continue }
      const seen = new Set<string>()
      const sources = [...e.sources, ...f.sources].filter((s) => { const k = `${s.type}|${s.url}`; if (seen.has(k)) return false; seen.add(k); return true }).slice(-MAX_SOURCES)
      if (f.confidence < e.confidence) { byId.set(f.id, { ...e, sources }); continue }
      const keepDates = e.dates_confirmed && !f.dates_confirmed
      byId.set(f.id, {
        ...f, sources, last_verified: f.last_verified > e.last_verified ? f.last_verified : e.last_verified,
        ...(keepDates ? { dates_confirmed: true, start_date: e.start_date, end_date: e.end_date } : {}),
      })
    }
    const policy = opts.dropSeed ?? 'matched'
    if (policy !== 'none' && published > 0) {
      const realFresh = fresh.filter((f) => f.status === 'active' && f.confidence >= config.publishThreshold)
      for (const [id, e] of byId) {
        const isSeed = e.sources.length > 0 && e.sources.every((s) => s.type === 'seed')
        if (isSeed && (policy === 'all' || realFresh.some((f) => looksSame(asCandidate(f), asCandidate(e))))) byId.delete(id)
      }
    }
  }
  const today = isoDay(opts.today)
  let archived = 0
  const events = [...byId.values()].map((e) => {
    if (e.status === 'active' && e.end_date < today) { archived++; return { ...e, status: 'past' as const } }
    return e
  })
  events.sort((a, b) => a.start_date.localeCompare(b.start_date) || a.name.localeCompare(b.name))
  return { events, quarantined, archived }
}

export function writeEventsAtomic(path: string, events: ConfEvent[]): void {
  events.forEach((e, i) => {
    const r = EventSchema.safeParse(e)
    if (!r.success) throw new Error(`Refusing to write: event #${i} invalid: ${r.error.issues[0]?.message}`)
  })
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(events, null, 2) + '\n')
  renameSync(tmp, path)
}
