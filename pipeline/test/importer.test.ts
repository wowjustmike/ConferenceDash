import { openDb } from '../src/db/db'
import { evidenceFor, loadEvents } from '../src/db/store'
import { importEventsJson } from '../src/importer'
import type { ConfEvent } from '../../web/src/lib/schema'

const mk = (id: string, types: string[], o: Partial<ConfEvent> = {}): ConfEvent => ({
  id, name: id.toUpperCase(), start_date: '2027-01-06', end_date: '2027-01-09', dates_confirmed: false, city: 'Las Vegas', state: 'Nevada', venue: '', organizer: '',
  topics: ['Tech'], est_attendance: null, official_url: `https://${id}.example`,
  sources: types.map((t, i) => ({ url: t === 'confs.tech' ? 'https://raw.githubusercontent.com/x/y.json' : t === 'seed' ? `https://${id}.example` : `https://src${i}.example/p`, type: t as never, fetched_at: '2026-11-01T00:00:00Z' })),
  last_verified: '2026-11-10', confidence: 0.7, status: 'active', ...o,
})
const fixture = [mk('seeded', ['seed']), mk('tech', ['confs.tech']), mk('venue', ['html']), mk('verified', ['jsonld'], { dates_confirmed: true })]

const counts = (db: ReturnType<typeof openDb>) => ({
  events: (db.prepare('select count(*) c from events').get() as { c: number }).c,
  obs: (db.prepare('select count(*) c from observations').get() as { c: number }).c,
  links: (db.prepare('select count(*) c from event_observations').get() as { c: number }).c,
})

test('imports events and one observation per source, plus an official-site observation for verified events', () => {
  const db = openDb(':memory:')
  const r = importEventsJson(db, fixture)
  expect(r.events).toBe(4)
  expect(counts(db).events).toBe(4)
  expect(counts(db).obs).toBe(5) // 4 source observations + 1 official-site for the verified event
  expect(counts(db).links).toBe(5)
  const kinds = (id: string) => evidenceFor(db, id).map((e) => e.kind).sort()
  expect(kinds('seeded')).toEqual(['seed'])
  expect(kinds('tech')).toEqual(['directory'])
  expect(kinds('venue')).toEqual(['venue-calendar'])
  expect(kinds('verified')).toEqual(['official-site', 'venue-calendar'])
  expect(evidenceFor(db, 'verified').find((e) => e.kind === 'official-site')).toMatchObject({ confirmsEdition: true, seenAt: '2026-11-10' })
})
test('copy sites map to shared families', () => {
  const db = openDb(':memory:')
  importEventsJson(db, fixture)
  expect(evidenceFor(db, 'tech')[0].family).toBe('confs.tech')
})
test('sample events are flagged; real ones are not', () => {
  const db = openDb(':memory:')
  importEventsJson(db, fixture)
  const rows = db.prepare('select id, is_sample s from events order by id').all() as { id: string; s: number }[]
  expect(rows.filter((r) => r.s === 1).map((r) => r.id)).toEqual(['seeded'])
})
test('a verified SAMPLE event gets no official-site observation', () => {
  const db = openDb(':memory:')
  importEventsJson(db, [mk('s2', ['seed'], { dates_confirmed: true })])
  expect(evidenceFor(db, 's2').map((e) => e.kind)).toEqual(['seed'])
})
test('importing twice is idempotent', () => {
  const db = openDb(':memory:')
  importEventsJson(db, fixture)
  const first = counts(db)
  const again = importEventsJson(db, fixture)
  expect(counts(db)).toEqual(first)
  expect(again.observations).toBe(0)
  expect(loadEvents(db)).toHaveLength(4)
})
