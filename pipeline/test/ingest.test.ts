import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/db/db'
import { saveToInbox } from '../src/inbox'
import { ingestBatch, loadIngested } from '../src/ingest'

const win = { start: '2026-11-15', end: '2027-12-31' }
const URL1 = 'https://venue.example/events'
const PAGE = 'Upcoming: Craft Brewers Conference Apr 12-15, 2027 at Nashville Music City Center. Holiday Gala Dec 5 2026 Nashville. Old Expo Jan 5-6, 2025 Nashville.'
function setup() {
  const db = openDb(':memory:')
  const dir = mkdtempSync(join(tmpdir(), 'ing-'))
  saveToInbox(db, dir, { url: URL1, sourceId: 'venue.example', text: PAGE })
  return db
}
const ev = (o: Record<string, unknown> = {}) => ({
  name: 'Craft Brewers Conference', start_date: '2027-04-12', end_date: '2027-04-15', city: 'Nashville', state: 'TN', venue: 'Music City Center',
  evidence: 'Craft Brewers Conference Apr 12-15, 2027', ...o,
})
const batch = (events: unknown[], kind = 'venue-calendar') => ({ source: { url: URL1, kind }, events })

test('valid records are stored with normalized fields and the right evidence kind', () => {
  const db = setup()
  const r = ingestBatch(db, batch([ev()]), { window: win, today: new Date('2026-11-15T12:00:00Z') })
  expect(r.accepted).toBe(1)
  expect(r.rejected).toEqual([])
  const c = loadIngested(db)
  expect(c).toHaveLength(1)
  expect(c[0]).toMatchObject({ name: 'Craft Brewers Conference', state: 'Tennessee', venue: 'Music City Center', start_date: '2027-04-12' })
  expect(c[0].source).toMatchObject({ url: URL1, type: 'claude-venue-calendar' })
})
test('organizer pages link the event to the page itself so the update can verify it there', () => {
  const db = setup()
  ingestBatch(db, batch([ev()], 'organizer'), { window: win, today: new Date('2026-11-15T12:00:00Z') })
  const [c] = loadIngested(db)
  expect(c.source).toMatchObject({ url: URL1, type: 'claude-organizer' })
  expect(c.official_url).toBe(URL1)
  // An explicit official link still wins.
  ingestBatch(db, batch([ev({ name: 'Craft Brewers Conference', official_url: 'https://cbc.example/' })], 'organizer'), { window: win, today: new Date('2026-11-15T12:00:00Z') })
  expect(loadIngested(db)[0].official_url).toBe('https://cbc.example/')
})
test('rejects records whose evidence quote is not on the saved page, or does not contain the event name', () => {
  const db = setup()
  const r = ingestBatch(db, batch([ev({ evidence: 'a quote that is not on the page' }), ev({ name: 'Other Expo', evidence: 'Craft Brewers Conference Apr 12-15, 2027' })]), { window: win, today: new Date() })
  expect(r.accepted).toBe(0)
  expect(r.rejected.map((x) => x.reason).join('|')).toMatch(/evidence not found.*evidence does not contain/s)
})
test('quote matching ignores case and whitespace differences', () => {
  const db = setup()
  expect(ingestBatch(db, batch([ev({ evidence: 'craft   brewers conference\nApr 12-15,   2027' })]), { window: win, today: new Date() }).accepted).toBe(1)
})
test('rejects out-of-window dates, impossible dates and unknown states; reports why', () => {
  const db = setup()
  const r = ingestBatch(db, batch([
    ev({ name: 'Old Expo', evidence: 'Old Expo Jan 5-6, 2025', start_date: '2025-01-05', end_date: '2025-01-06' }),
    ev({ start_date: '2027-02-30', end_date: '2027-02-31' }),
    ev({ state: 'Atlantis' }),
    ev({ end_date: '2027-04-01' }),
  ]), { window: win, today: new Date() })
  expect(r.accepted).toBe(0)
  expect(r.rejected.map((x) => x.reason)).toEqual([expect.stringMatching(/window/), expect.stringMatching(/date/), expect.stringMatching(/state/), expect.stringMatching(/date/)])
})
test('rejects batches for pages that are not in the inbox', () => {
  const db = setup()
  expect(() => ingestBatch(db, { source: { url: 'https://unknown.example/x', kind: 'directory' }, events: [ev()] }, { window: win, today: new Date() })).toThrow(/inbox/)
})
test('an exclude reason records an exclusion instead of a candidate', () => {
  const db = setup()
  const r = ingestBatch(db, batch([ev({ name: 'Holiday Gala', evidence: 'Holiday Gala Dec 5 2026', start_date: '2026-12-05', end_date: '2026-12-05', exclude: 'social' })]), { window: win, today: new Date('2026-11-15') })
  expect(r.excluded).toBe(1)
  expect(loadIngested(db)).toHaveLength(0)
  expect(db.prepare('select reason from exclusions').all()).toEqual([{ reason: 'social' }])
})
test('re-ingesting the same batch is idempotent', () => {
  const db = setup()
  ingestBatch(db, batch([ev()]), { window: win, today: new Date() })
  const again = ingestBatch(db, batch([ev()]), { window: win, today: new Date() })
  expect(again.accepted).toBe(1)
  expect(loadIngested(db)).toHaveLength(1)
})
test('unknown source kinds are refused', () => {
  const db = setup()
  expect(() => ingestBatch(db, batch([ev()], 'made-up'), { window: win, today: new Date() })).toThrow(/kind/)
})
