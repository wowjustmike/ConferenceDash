import { openDb, type Db } from '../src/db/db'
import { loadEvents } from '../src/db/store'
import { runPipeline, type RunDeps } from '../src/run'
import { LlmBudget, type LlmClient } from '../src/extract/llm'
import type { ConfEvent } from '../../web/src/lib/schema'

const NOW = new Date('2026-11-15T12:00:00Z')
const today = new Date(2026, 10, 15)
const CONFS = 'https://raw.githubusercontent.com/tech-conferences/conference-data/main/conferences/2027/javascript.json'
const confs = JSON.stringify([
  { name: 'HalfStack Phoenix', url: 'https://halfstackconf.com/phoenix', startDate: '2027-02-05', endDate: '2027-02-05', city: 'Phoenix, AZ', country: 'U.S.A.', online: false },
  { name: 'Summer Music Festival', url: 'https://fest.example', startDate: '2027-06-05', endDate: '2027-06-07', city: 'Austin, TX', country: 'U.S.A.', online: false },
])
const ics = 'BEGIN:VEVENT\nSUMMARY:CES 2027\nDTSTART;VALUE=DATE:20270106\nDTEND;VALUE=DATE:20270110\nURL:https://www.ces.tech\nEND:VEVENT'
const pages: Record<string, string | null> = {
  [CONFS]: confs, 'https://venue.example/feed.ics': ics,
  'https://www.ces.tech': '<html><body><p>January 6-9, 2027 Las Vegas</p></body></html>', 'https://halfstackconf.com/phoenix': null,
}
const llm: LlmClient = { extract: async () => ({ events: [] }) }
const count = (db: Db, t: string) => (db.prepare(`select count(*) c from ${t}`).get() as { c: number }).c

function deps(over: Partial<RunDeps> = {}): RunDeps {
  return {
    fetchText: async (u) => (u in pages ? pages[u] : null), fetchJson: async () => null, llm, budget: new LlmBudget(300), now: () => NOW, today,
    registry: [{ id: 'venue-feed', kind: 'ical', url: 'https://venue.example/feed.ics', type: 'ical', venue: 'Las Vegas Convention Center', city: 'Las Vegas', state: 'NV' }],
    existing: [], confsYears: [2027], confsTopics: ['javascript'], tmKey: undefined, tmVenues: [], db: openDb(':memory:'), writeOut: () => {}, ...over,
  }
}
const run = (d: RunDeps) => runPipeline({ tier: 'weekly', dryRun: false, deps: d })

test('one run stores observations, links them to published events and records the run', async () => {
  const d = deps()
  await run(d)
  expect(loadEvents(d.db).map((e) => e.name)).toEqual(['CES 2027'])
  expect(count(d.db, 'observations')).toBeGreaterThanOrEqual(3)
  const links = d.db.prepare("select o.evidence_kind k from event_observations eo join observations o on o.id = eo.observation_id").all() as { k: string }[]
  expect(links.map((l) => l.k).sort()).toEqual(['official-site', 'venue-calendar'])
  expect(count(d.db, 'runs')).toBe(1)
})
test('a second identical run adds no events and no observations', async () => {
  const d = deps()
  await run(d)
  const before = { e: count(d.db, 'events'), o: count(d.db, 'observations'), l: count(d.db, 'event_observations') }
  await run(d)
  expect({ e: count(d.db, 'events'), o: count(d.db, 'observations'), l: count(d.db, 'event_observations') }).toEqual(before)
})
test('excluded candidates are remembered but never become events', async () => {
  const d = deps()
  await run(d)
  expect(loadEvents(d.db).some((e) => /festival/i.test(e.name))).toBe(false)
  const ex = d.db.prepare('select reason from exclusions').all() as { reason: string }[]
  expect(ex).toEqual([{ reason: 'festival' }])
  await run(d)
  expect(count(d.db, 'exclusions')).toBe(1)
})
test('the classified kind is stored on the event', async () => {
  const d = deps()
  await run(d)
  expect(loadEvents(d.db)[0].kind).toBeTruthy()
})
test('a failing save rolls everything back and the run records the failure', async () => {
  const real = openDb(':memory:')
  const failing = new Proxy(real, {
    get(t, p) {
      if (p === 'prepare') return (sql: string) => { if (/insert into events/.test(sql)) throw new Error('disk full'); return t.prepare(sql) }
      const v = (t as never)[p as never] as unknown
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v
    },
  })
  const r = await run(deps({ db: failing }))
  expect(r.errors.join(' ')).toMatch(/disk full/)
  expect(count(real, 'observations')).toBe(0)
  expect(count(real, 'events')).toBe(0)
  const runRow = real.prepare('select report_json j from runs').get() as { j: string }
  expect(runRow.j).toMatch(/disk full/)
})
test('existing events are imported on first use and a matching real event replaces the sample one', async () => {
  const seed: ConfEvent = { id: 'ces-2027-2027', name: 'CES 2027', start_date: '2027-01-06', end_date: '2027-01-09', dates_confirmed: false, city: 'Las Vegas', state: 'Nevada', venue: 'LVCC', organizer: 'CTA', topics: ['Tech'], est_attendance: 1, official_url: 'https://www.ces.tech', sources: [{ url: 'https://www.ces.tech', type: 'seed', fetched_at: '2026-11-01T00:00:00Z' }], last_verified: '2026-11-10', confidence: 0.5, status: 'active' }
  const other: ConfEvent = { ...seed, id: 'other-seed', name: 'Other Sample', official_url: 'https://other.example', sources: [{ url: 'https://other.example', type: 'seed', fetched_at: '2026-11-01T00:00:00Z' }] }
  const d = deps({ existing: [seed, other] })
  await run(d)
  const ids = loadEvents(d.db).map((e) => e.id)
  expect(ids).toContain('ces-2027-2027')       // id reused from the existing event
  expect(loadEvents(d.db).find((e) => e.id === 'ces-2027-2027')!.sources.some((s) => s.type !== 'seed')).toBe(true)
  expect(ids).toContain('other-seed')          // unmatched sample survives with only one productive source
})

test('verifying against the venue\'s own listing page counts as a venue calendar (2 pts), not an organizer site (3 pts)', async () => {
  const venueIcs = 'BEGIN:VEVENT\nSUMMARY:Venue Hosted Expo\nDTSTART;VALUE=DATE:20270201\nDTEND;VALUE=DATE:20270203\nURL:https://venue.example/events/hosted-expo\nEND:VEVENT'
  const d = deps({
    fetchText: async (u) => (u === 'https://venue.example/feed.ics' ? venueIcs : u === 'https://venue.example/events/hosted-expo' ? '<html><body>Feb 1-2, 2027 Las Vegas</body></html>' : null),
    confsTopics: [],
  })
  await run(d)
  const kinds = d.db.prepare("select o.evidence_kind k, o.confirms_edition c from event_observations eo join observations o on o.id = eo.observation_id").all() as { k: string; c: number }[]
  expect(kinds.map((x) => x.k)).not.toContain('official-site')
  expect(kinds.every((x) => x.k === 'venue-calendar')).toBe(true)
  const { recomputeSignals } = await import('../src/exporter')
  recomputeSignals(d.db, today)
  expect((d.db.prepare('select signal_bars b from events').get() as { b: number }).b).toBe(2)
})
test('an organizer-hosted official page on a different host still counts as official-site', async () => {
  const d = deps()
  await run(d)
  const kinds = (d.db.prepare('select o.evidence_kind k from event_observations eo join observations o on o.id = eo.observation_id').all() as { k: string }[]).map((x) => x.k)
  expect(kinds).toContain('official-site')
})
