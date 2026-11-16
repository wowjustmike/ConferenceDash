import { familyOf, loadCredibility, type EvidenceKind } from './credibility'
import { withTransaction, type Db } from './db/db'
import { addObservation, linkObservation, saveEvents, upsertSource } from './db/store'
import { isSampleEvent } from './sample'
import type { ConfEvent } from '../../web/src/lib/schema'

const KIND: Record<string, EvidenceKind> = {
  'confs.tech': 'directory', html: 'venue-calendar', jsonld: 'venue-calendar', ical: 'venue-calendar', api: 'ticketing',
  aggregator: 'aggregator', llm: 'aggregator', submission: 'aggregator', seed: 'seed',
}
const hostOf = (u: string) => { try { return new URL(u).host } catch { return 'unknown' } }

export function importEventsJson(db: Db, events: ConfEvent[]): { events: number; observations: number } {
  const cred = loadCredibility()
  let observations = 0
  withTransaction(db, () => {
    saveEvents(db, events, Object.fromEntries(events.map((e) => [e.id, { isSample: isSampleEvent(e) }])))
    for (const e of events) {
      for (const s of e.sources) {
        const kind = KIND[s.type] ?? 'aggregator'
        const host = hostOf(s.url)
        const sourceId = `${s.type}:${host}`
        upsertSource(db, { id: sourceId, kind, family: familyOf(host, cred), credibility: cred.points[kind] })
        const o = addObservation(db, {
          sourceId, rawName: e.name, startDate: e.start_date, endDate: e.end_date, city: e.city, state: e.state, venue: e.venue || undefined,
          organizer: e.organizer || undefined, url: s.url, evidenceKind: kind, seenAt: s.fetched_at.slice(0, 10), extractor: 'import',
        })
        if (o.inserted) observations++
        linkObservation(db, e.id, o.id, 'rule')
      }
      if (e.dates_confirmed && !isSampleEvent(e)) {
        const host = hostOf(e.official_url)
        const sourceId = `official:${host}`
        upsertSource(db, { id: sourceId, kind: 'organizer-site', family: familyOf(host, cred), credibility: cred.points['official-site'] })
        const o = addObservation(db, {
          sourceId, rawName: e.name, startDate: e.start_date, endDate: e.end_date, city: e.city, state: e.state, url: e.official_url,
          evidenceKind: 'official-site', confirmsEdition: true, seenAt: e.last_verified, extractor: 'import',
        })
        if (o.inserted) observations++
        linkObservation(db, e.id, o.id, 'rule')
      }
    }
  })
  return { events: events.length, observations }
}
