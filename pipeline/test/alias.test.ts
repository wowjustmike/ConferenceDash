import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../src/db/db'
import { addObservation, deleteMissingEvents, linkObservation, loadEvents, saveEvents, upsertSource, type StoredEvent } from '../src/db/store'
import { collapseAliases, unalias } from '../src/alias'
import { buildExport, recomputeSignals } from '../src/exporter'
import { runExport } from '../src/update'

const today = new Date('2026-11-15T12:00:00Z')
const LA = { city: 'Los Angeles', state: 'California', start_date: '2026-11-20', end_date: '2026-11-29' }
const mk = (id: string, name: string, o: Partial<StoredEvent> = {}): StoredEvent => ({
  id, name, dates_confirmed: false, venue: '', organizer: '', topics: ['Other'], est_attendance: null, official_url: `https://${id}.example`,
  sources: [{ url: `https://${id}.example`, type: 'jsonld', fetched_at: '2026-11-10T00:00:00Z' }], last_verified: '2026-11-10', confidence: 0.9, status: 'active', ...LA, ...o,
})
function seed(db: Db) {
  upsertSource(db, { id: 'venue', kind: 'venue-calendar', family: 'lacc.com', credibility: 2 })
  upsertSource(db, { id: 'agg', kind: 'aggregator', family: 'agg.com', credibility: 1 })
}
function observe(db: Db, eventId: string, sourceId: string, kind: 'venue-calendar' | 'aggregator') {
  const r = addObservation(db, { sourceId, rawName: eventId, startDate: LA.start_date, endDate: LA.end_date, city: LA.city, url: `https://${sourceId}.example/${eventId}`, evidenceKind: kind, seenAt: '2026-11-10', extractor: 't' })
  linkObservation(db, eventId, r.id, 'rule')
}
/** Two stored rows for the same real-world event: the venue-backed one should survive. */
function twoAutoShows(db: Db) {
  seed(db)
  saveEvents(db, [mk('la-auto-show-2026', 'LA Auto Show 2026'), mk('angeles-auto-los-2026-los-angeles', 'Los Angeles Auto Show 2026')])
  observe(db, 'la-auto-show-2026', 'agg', 'aggregator')
  observe(db, 'angeles-auto-los-2026-los-angeles', 'venue', 'venue-calendar')
  recomputeSignals(db, today)
}
const aliasOf = (db: Db, id: string) => (db.prepare('select alias_of a from events where id = ?').get(id) as { a: string | null }).a

test('collapseAliases marks the weaker duplicate as an alias of the stronger one and hides it from loadEvents', () => {
  const db = openDb(':memory:'); twoAutoShows(db)
  expect(collapseAliases(db)).toEqual([{ alias: 'la-auto-show-2026', of: 'angeles-auto-los-2026-los-angeles' }])
  expect(aliasOf(db, 'la-auto-show-2026')).toBe('angeles-auto-los-2026-los-angeles')
  expect(loadEvents(db).map((e) => e.id)).toEqual(['angeles-auto-los-2026-los-angeles'])
  expect(db.prepare('select count(*) c from events').get()).toEqual({ c: 2 }) // never deleted
})
test('the survivor inherits the alias evidence, so its signal goes up', () => {
  const db = openDb(':memory:'); twoAutoShows(db)
  collapseAliases(db); recomputeSignals(db, today)
  const [only] = buildExport(db, { windowStart: '2026-11-15', windowEnd: '2027-12-31', sampleDropThreshold: 100, today })
  expect(only.id).toBe('angeles-auto-los-2026-los-angeles')
  expect(only.signal.points).toBe(3) // venue 2 + aggregator 1
  expect(only.sources.map((s) => s.url).sort()).toEqual(['https://angeles-auto-los-2026-los-angeles.example', 'https://la-auto-show-2026.example'])
})
test('collapseAliases is idempotent and re-links observations added to the alias later', () => {
  const db = openDb(':memory:'); twoAutoShows(db)
  collapseAliases(db)
  expect(collapseAliases(db)).toEqual([])
  observe(db, 'la-auto-show-2026', 'venue', 'venue-calendar') // a later run wrote to the alias id
  collapseAliases(db)
  const linked = db.prepare('select count(*) c from event_observations where event_id = ?').get('angeles-auto-los-2026-los-angeles') as { c: number }
  expect(linked.c).toBe(3)
})
test('distinct events in the same city and year are not collapsed', () => {
  const db = openDb(':memory:'); seed(db)
  saveEvents(db, [mk('la-auto-show-2026', 'Los Angeles Auto Show'), mk('la-comic-con-2026', 'Los Angeles Comic Con')])
  expect(collapseAliases(db)).toEqual([])
})
test('unalias restores the row and vetoes the pair so it is not collapsed again', () => {
  const db = openDb(':memory:'); twoAutoShows(db)
  collapseAliases(db)
  expect(unalias(db, 'la-auto-show-2026')).toBe(true)
  expect(unalias(db, 'la-auto-show-2026')).toBe(false)
  expect(aliasOf(db, 'la-auto-show-2026')).toBeNull()
  expect(collapseAliases(db)).toEqual([])
  expect(loadEvents(db)).toHaveLength(2)
})
test('deleteMissingEvents keeps alias rows', () => {
  const db = openDb(':memory:'); twoAutoShows(db)
  collapseAliases(db)
  expect(deleteMissingEvents(db, new Set(['angeles-auto-los-2026-los-angeles']))).toBe(0)
  expect(db.prepare('select count(*) c from events').get()).toEqual({ c: 2 })
})
test('runExport collapses aliases before scoring and exports one event', async () => {
  const db = openDb(':memory:'); twoAutoShows(db)
  const dir = mkdtempSync(join(tmpdir(), 'alias-'))
  const s = await runExport({ db, exportDir: dir, today, exportOpts: { windowStart: '2026-11-15', windowEnd: '2027-12-31', sampleDropThreshold: 100, maxBytes: 5e6 } })
  expect(s.exported).toBe(1)
  expect(s.byBars).toEqual({ 1: 0, 2: 0, 3: 1 })
  expect(aliasOf(db, 'la-auto-show-2026')).toBe('angeles-auto-los-2026-los-angeles')
})
