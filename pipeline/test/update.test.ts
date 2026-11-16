import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/db/db'
import { LlmBudget, type LlmClient } from '../src/extract/llm'
import type { RunDeps } from '../src/run'
import { runExport, runUpdate } from '../src/update'
import type { ConfEvent } from '../../web/src/lib/schema'

const NOW = new Date('2026-11-15T12:00:00Z')
const today = new Date(2026, 10, 15)
const ics = 'BEGIN:VEVENT\nSUMMARY:CES 2027\nDTSTART;VALUE=DATE:20270106\nDTEND;VALUE=DATE:20270110\nURL:https://www.ces.tech\nEND:VEVENT'
const pages: Record<string, string | null> = { 'https://venue.example/feed.ics': ics, 'https://www.ces.tech': '<html><body>January 6-9, 2027 Las Vegas</body></html>' }
const llm: LlmClient = { extract: async () => ({ events: [] }) }
const sample: ConfEvent = { id: 'sample-1', name: 'Sample Expo', start_date: '2027-05-01', end_date: '2027-05-02', dates_confirmed: false, city: 'Austin', state: 'Texas', venue: '', organizer: '', topics: ['Tech'], est_attendance: null, official_url: 'https://sample.example', sources: [{ url: 'https://sample.example', type: 'seed', fetched_at: '2026-11-01T00:00:00Z' }], last_verified: '2026-11-01', confidence: 0.5, status: 'active' }

const deps = (): Omit<RunDeps, 'db'> => ({
  fetchText: async (u) => (u in pages ? pages[u] : null), fetchJson: async () => null, llm, budget: new LlmBudget(300), now: () => NOW, today,
  registry: [{ id: 'venue-feed', kind: 'ical', url: 'https://venue.example/feed.ics', type: 'ical', venue: 'Las Vegas Convention Center', city: 'Las Vegas', state: 'NV' }],
  existing: [sample], confsYears: [2027], confsTopics: [], tmKey: undefined, tmVenues: [], writeOut: () => {},
})
const opts = (dir: string, db = openDb(':memory:')) => ({
  db, exportDir: dir, tier: 'weekly' as const, dryRun: false, deps: deps(), today,
  exportOpts: { windowStart: '2026-11-15', windowEnd: '2027-12-31', sampleDropThreshold: 100, maxBytes: 5_000_000 },
})

test('first run imports the sample, publishes, scores and exports; summary counts by bars', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'upd-'))
  const s = await runUpdate(opts(dir))
  const exported = JSON.parse(readFileSync(join(dir, 'events.json'), 'utf8')) as (ConfEvent & { signal: { bars: number } })[]
  const ces = exported.find((e) => e.name === 'CES 2027')!
  expect(ces.signal.bars).toBe(3)
  expect(exported.find((e) => e.id === 'sample-1')!.signal.bars).toBe(1)
  expect(s.byBars).toEqual({ 1: 1, 2: 0, 3: 1 })
  expect(s.exported).toBe(2)
})
test('a second run changes nothing: export is byte-identical', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'upd-'))
  const db = openDb(':memory:')
  await runUpdate(opts(dir, db))
  const first = readFileSync(join(dir, 'events.json'), 'utf8')
  await runUpdate({ ...opts(dir, db), deps: { ...deps(), existing: [] } })
  expect(readFileSync(join(dir, 'events.json'), 'utf8')).toBe(first)
})
test('dry run writes no export and no database changes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'upd-'))
  const o = opts(dir)
  await runUpdate({ ...o, dryRun: true })
  expect(() => readFileSync(join(dir, 'events.json'))).toThrow()
  expect((o.db.prepare('select count(*) c from events').get() as { c: number }).c).toBe(0)
})
test('an export failure keeps the previous events.json', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'upd-'))
  const o = opts(dir)
  await runUpdate(o)
  const before = readFileSync(join(dir, 'events.json'), 'utf8')
  o.db.prepare("update events set official_url = 'javascript:alert(1)' where name = 'CES 2027'").run()
  await expect(runExport({ db: o.db, exportDir: dir, today, exportOpts: o.exportOpts })).rejects.toThrow()
  expect(readFileSync(join(dir, 'events.json'), 'utf8')).toBe(before)
})
test('runExport alone re-scores and exports from the database', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'upd-'))
  const o = opts(dir)
  await runUpdate(o)
  writeFileSync(join(dir, 'events.json'), '[]\n')
  const s = await runExport({ db: o.db, exportDir: dir, today, exportOpts: o.exportOpts })
  expect(s.exported).toBe(2)
  expect(JSON.parse(readFileSync(join(dir, 'events.json'), 'utf8'))).toHaveLength(2)
})
