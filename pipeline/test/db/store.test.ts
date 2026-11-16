import { openDb } from '../../src/db/db'
import { addObservation, evidenceFor, linkObservation, loadEvents, markExcluded, recordFetch, saveEvents, upsertSource, type StoredEvent } from '../../src/db/store'

const mk = (o: Partial<StoredEvent> = {}): StoredEvent => ({
  id: 'ces-2027-las-vegas', name: 'CES 2027', start_date: '2027-01-06', end_date: '2027-01-09', dates_confirmed: true, city: 'Las Vegas', state: 'Nevada',
  venue: 'LVCC', organizer: 'CTA', topics: ['Tech', 'Entertainment'], est_attendance: null, official_url: 'https://www.ces.tech',
  sources: [{ url: 'https://a.example', type: 'jsonld', fetched_at: '2026-11-01T00:00:00Z' }], last_verified: '2026-11-10', confidence: 0.9, status: 'active', ...o,
})
const setup = () => {
  const db = openDb(':memory:')
  upsertSource(db, { id: 'confs', kind: 'directory', family: 'confs.tech', credibility: 1 })
  upsertSource(db, { id: 'org', kind: 'organizer-site', family: 'ces.tech', credibility: 3 })
  return db
}
const base = { sourceId: 'confs', rawName: 'CES', startDate: '2027-01-06', city: 'Las Vegas', url: 'https://x.example', evidenceKind: 'directory' as const, seenAt: '2026-11-01', extractor: 'feed' }

test('addObservation is idempotent and refreshes seen_at', () => {
  const db = setup()
  expect(addObservation(db, base).inserted).toBe(true)
  const again = addObservation(db, { ...base, seenAt: '2026-11-09' })
  expect(again.inserted).toBe(false)
  const rows = db.prepare('select seen_at from observations').all() as { seen_at: string }[]
  expect(rows).toEqual([{ seen_at: '2026-11-09' }])
})
test('the latest check wins: a later non-confirming check revokes an earlier confirmation', () => {
  const db = setup()
  addObservation(db, { ...base, confirmsEdition: true, seenAt: '2026-01-01' })
  addObservation(db, { ...base, confirmsEdition: false, seenAt: '2026-11-15' })
  expect(db.prepare('select confirms_edition c, seen_at s from observations').get()).toEqual({ c: 0, s: '2026-11-15' })
  addObservation(db, { ...base, confirmsEdition: true, seenAt: '2026-11-20' })
  expect((db.prepare('select confirms_edition c from observations').get() as { c: number }).c).toBe(1)
})
test('recordFetch derives the host and returns an id', () => {
  const db = setup()
  const id = recordFetch(db, { url: 'https://www.lvcva.com/events', status: 200, bytes: 10 })
  expect((db.prepare('select host from fetches where id = ?').get(id) as { host: string }).host).toBe('www.lvcva.com')
})
test('saveEvents/loadEvents round-trips every field', () => {
  const db = setup()
  const e = mk({ kind: 'trade_show', signal: { points: 3, bars: 3, flags: [], evidence: [{ label: 'x', family: 'ces.tech', kind: 'official-site', points: 3, seenAt: '2026-11-10' }] } })
  saveEvents(db, [e])
  expect(loadEvents(db)).toEqual([e])
})
test('saveEvents twice keeps one row and applies updates', () => {
  const db = setup()
  saveEvents(db, [mk()])
  saveEvents(db, [mk({ venue: 'Venetian' })])
  expect((db.prepare('select count(*) c from events').get() as { c: number }).c).toBe(1)
  expect(loadEvents(db)[0].venue).toBe('Venetian')
})
test('a failing saveEvents rolls everything back', () => {
  const db = setup()
  expect(() => saveEvents(db, [mk(), mk({ id: 'bad', status: 'bogus' as never })])).toThrow()
  expect(loadEvents(db)).toEqual([])
})
test('markExcluded hides the event from loadEvents but keeps the row, and saveEvents does not resurrect it', () => {
  const db = setup()
  saveEvents(db, [mk()])
  markExcluded(db, 'ces-2027-las-vegas', 'festival')
  expect(loadEvents(db)).toEqual([])
  saveEvents(db, [mk({ venue: 'changed' })])
  expect(loadEvents(db)).toEqual([])
  expect((db.prepare('select excluded_reason r from events').get() as { r: string }).r).toBe('festival')
})
test('evidenceFor returns only linked observations, mapped to Evidence', () => {
  const db = setup()
  saveEvents(db, [mk()])
  const a = addObservation(db, base).id
  addObservation(db, { ...base, rawName: 'Other Show' })
  const o = addObservation(db, { sourceId: 'org', rawName: 'CES 2027', startDate: '2027-01-06', city: 'Las Vegas', url: 'https://www.ces.tech', evidenceKind: 'official-site', confirmsEdition: true, seenAt: '2026-11-10', extractor: 'verify' }).id
  linkObservation(db, 'ces-2027-las-vegas', a, 'rule')
  linkObservation(db, 'ces-2027-las-vegas', o, 'rule')
  linkObservation(db, 'ces-2027-las-vegas', o, 'rule') // idempotent
  const ev = evidenceFor(db, 'ces-2027-las-vegas')
  expect(ev).toHaveLength(2)
  expect(ev.find((x) => x.kind === 'official-site')).toMatchObject({ family: 'ces.tech', confirmsEdition: true, seenAt: '2026-11-10' })
  expect(ev.find((x) => x.kind === 'directory')).toMatchObject({ family: 'confs.tech', confirmsEdition: false })
})
