import type { ConfEvent } from '../../../web/src/lib/schema'
import type { Evidence, EvidenceKind } from '../credibility'
import { CLASSIFIER_VERSION, classifyKind } from '../classify'
import { withTransaction, type Db } from './db'

/** The web app's event shape, including the optional computed `signal` and `kind`. */
export type StoredEvent = ConfEvent
export interface ObservationInput {
  sourceId: string; fetchId?: number; rawName: string; startDate?: string; endDate?: string; city?: string; state?: string; venue?: string
  organizer?: string; url?: string; evidenceKind: EvidenceKind; confirmsEdition?: boolean; seenAt: string; extractor: string
}

const n = <T>(v: T | undefined | null): T | null => (v === undefined ? null : v)

export function upsertSource(db: Db, s: { id: string; kind: string; family: string; credibility: number; notes?: string }): void {
  db.prepare(`insert into sources(id, kind, family, credibility, notes) values (?, ?, ?, ?, ?)
    on conflict(id) do update set kind = excluded.kind, family = excluded.family, credibility = excluded.credibility, notes = coalesce(excluded.notes, sources.notes)`)
    .run(s.id, s.kind, s.family, s.credibility, n(s.notes))
}

export function recordFetch(db: Db, f: { url: string; status: number | null; etag?: string; contentHash?: string; bytes?: number }): number {
  const r = db.prepare('insert into fetches(url, host, status, fetched_at, etag, content_hash, bytes) values (?, ?, ?, ?, ?, ?, ?)')
    .run(f.url, new URL(f.url).host, n(f.status), new Date().toISOString(), n(f.etag), n(f.contentHash), n(f.bytes))
  return Number(r.lastInsertRowid)
}

export function addObservation(db: Db, o: ObservationInput): { id: number; inserted: boolean } {
  const existing = db.prepare(`select id from observations where source_id = ? and raw_name = ? and coalesce(start_date,'') = ? and coalesce(city,'') = ? and coalesce(url,'') = ? and evidence_kind = ?`)
    .get(o.sourceId, o.rawName, o.startDate ?? '', o.city ?? '', o.url ?? '', o.evidenceKind) as { id: number } | undefined
  const confirms = o.confirmsEdition ? 1 : 0
  if (existing) {
    // The latest check wins: a later check that no longer confirms revokes an earlier confirmation.
    db.prepare('update observations set seen_at = max(seen_at, ?), confirms_edition = ?, fetch_id = coalesce(?, fetch_id) where id = ?')
      .run(o.seenAt, confirms, n(o.fetchId), existing.id)
    return { id: existing.id, inserted: false }
  }
  const r = db.prepare(`insert into observations(source_id, fetch_id, raw_name, start_date, end_date, city, state, venue, organizer, url, evidence_kind, confirms_edition, seen_at, extractor)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(o.sourceId, n(o.fetchId), o.rawName, n(o.startDate), n(o.endDate), n(o.city), n(o.state), n(o.venue), n(o.organizer), n(o.url), o.evidenceKind, confirms, o.seenAt, o.extractor)
  return { id: Number(r.lastInsertRowid), inserted: true }
}

interface Row {
  id: string; name: string; start_date: string; end_date: string; dates_confirmed: number; city: string; state: string; venue: string; organizer: string
  topics_json: string; kind: string | null; est_attendance: number | null; official_url: string; status: 'active' | 'cancelled' | 'past'
  last_verified: string; confidence: number; signal_json: string | null; sources_json: string
}

export function loadEvents(db: Db): StoredEvent[] {
  const rows = db.prepare('select * from events where excluded_reason is null order by start_date, name').all() as unknown as Row[]
  return rows.map((r) => {
    const e: StoredEvent = {
      id: r.id, name: r.name, start_date: r.start_date, end_date: r.end_date, dates_confirmed: r.dates_confirmed === 1, city: r.city, state: r.state,
      venue: r.venue, organizer: r.organizer, topics: JSON.parse(r.topics_json), est_attendance: r.est_attendance, official_url: r.official_url,
      sources: JSON.parse(r.sources_json), last_verified: r.last_verified, confidence: r.confidence, status: r.status,
    }
    if (r.kind) e.kind = r.kind
    if (r.signal_json) e.signal = JSON.parse(r.signal_json)
    return e
  })
}

export function saveEvents(db: Db, events: StoredEvent[], meta: Record<string, { isSample?: boolean }> = {}): void {
  const stmt = db.prepare(`insert into events(id, name, start_date, end_date, dates_confirmed, city, state, venue, organizer, topics_json, kind, est_attendance, official_url,
      status, last_verified, confidence, signal_points, signal_bars, signal_json, is_sample, sources_json)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set name = excluded.name, start_date = excluded.start_date, end_date = excluded.end_date, dates_confirmed = excluded.dates_confirmed,
      city = excluded.city, state = excluded.state, venue = excluded.venue, organizer = excluded.organizer, topics_json = excluded.topics_json,
      kind = coalesce(excluded.kind, events.kind), est_attendance = excluded.est_attendance, official_url = excluded.official_url, status = excluded.status,
      last_verified = excluded.last_verified, confidence = excluded.confidence, signal_points = excluded.signal_points, signal_bars = excluded.signal_bars,
      signal_json = excluded.signal_json, is_sample = excluded.is_sample, sources_json = excluded.sources_json`)
  withTransaction(db, () => {
    for (const e of events) {
      stmt.run(e.id, e.name, e.start_date, e.end_date, e.dates_confirmed ? 1 : 0, e.city, e.state, e.venue, e.organizer, JSON.stringify(e.topics), n(e.kind),
        n(e.est_attendance), e.official_url, e.status, e.last_verified, e.confidence, e.signal?.points ?? 0, e.signal?.bars ?? 1, e.signal ? JSON.stringify(e.signal) : null,
        meta[e.id]?.isSample ? 1 : 0, JSON.stringify(e.sources))
    }
  })
}

export function linkObservation(db: Db, eventId: string, observationId: number, decidedBy: 'rule' | 'claude'): void {
  db.prepare('insert or ignore into event_observations(event_id, observation_id, decided_by) values (?, ?, ?)').run(eventId, observationId, decidedBy)
}

const LABEL: Record<EvidenceKind, string> = {
  'official-site': 'Confirmed on the official site', ticketing: 'Ticketing listing', 'venue-calendar': 'Venue calendar', directory: 'Directory listing',
  aggregator: 'Aggregator listing', seed: 'Sample data',
}

export function evidenceFor(db: Db, eventId: string): Evidence[] {
  const rows = db.prepare(`select o.evidence_kind k, o.confirms_edition c, o.seen_at s, src.family f from event_observations eo
    join observations o on o.id = eo.observation_id join sources src on src.id = o.source_id where eo.event_id = ?`).all(eventId) as { k: EvidenceKind; c: number; s: string; f: string }[]
  return rows.map((r) => ({ family: r.f, kind: r.k, confirmsEdition: r.c === 1, seenAt: r.s, label: r.k === 'seed' ? LABEL[r.k] : `${LABEL[r.k]} (${r.f})` }))
}

export function markExcluded(db: Db, eventId: string, reason: string): void {
  db.prepare('update events set excluded_reason = ? where id = ?').run(reason, eventId)
}

/** Removes non-excluded events that are no longer part of the published set (e.g. sample events replaced by real ones). */
export function deleteMissingEvents(db: Db, keepIds: Set<string>): number {
  const rows = db.prepare('select id from events where excluded_reason is null').all() as { id: string }[]
  const gone = rows.map((r) => r.id).filter((id) => !keepIds.has(id))
  withTransaction(db, () => {
    for (const id of gone) {
      db.prepare('delete from event_observations where event_id = ?').run(id)
      db.prepare('delete from events where id = ?').run(id)
    }
  })
  return gone.length
}

export function recordExclusion(db: Db, key: string, reason: string, name: string, seenAt: string): void {
  db.prepare('insert or ignore into exclusions(event_key, reason, name, seen_at, rule_version) values (?, ?, ?, ?, ?)').run(key, reason, name, seenAt, CLASSIFIER_VERSION)
}

/** Re-checks exclusions made by older classifier rules; releases (and un-hides) any the current rules would not make. Returns the released keys. */
export function reevaluateExclusions(db: Db): string[] {
  const old = db.prepare('select event_key k, name from exclusions where rule_version < ?').all(CLASSIFIER_VERSION) as { k: string; name: string }[]
  const released: string[] = []
  withTransaction(db, () => {
    for (const r of old) {
      if ('excluded' in classifyKind(r.name)) {
        db.prepare('update exclusions set rule_version = ? where event_key = ?').run(CLASSIFIER_VERSION, r.k)
      } else {
        db.prepare('delete from exclusions where event_key = ?').run(r.k)
        db.prepare('update events set excluded_reason = null where id = ?').run(r.k)
        released.push(r.k)
      }
    }
  })
  return released
}

/** Manual recovery from a wrong exclusion. */
export function unexclude(db: Db, key: string): boolean {
  let found = false
  withTransaction(db, () => {
    found = db.prepare('delete from exclusions where event_key = ?').run(key).changes > 0
    const e = db.prepare('update events set excluded_reason = null where id = ? and excluded_reason is not null').run(key)
    found = found || e.changes > 0
  })
  return found
}
