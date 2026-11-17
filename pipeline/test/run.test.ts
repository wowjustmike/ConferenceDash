import { openDb } from '../src/db/db'
import { loadEvents } from '../src/db/store'
import { runPipeline, type RunDeps } from '../src/run'
import { LlmBudget, type LlmClient } from '../src/extract/llm'
import type { ConfEvent } from '../../web/src/lib/schema'

const NOW = new Date('2026-11-15T12:00:00Z')
const today = new Date(2026, 10, 15)
const CONFS = 'https://raw.githubusercontent.com/tech-conferences/conference-data/main/conferences/2027/javascript.json'
const confsJson = JSON.stringify([{ name: 'HalfStack Phoenix', url: 'https://halfstackconf.com/phoenix', startDate: '2027-02-05', endDate: '2027-02-05', city: 'Phoenix, AZ', country: 'U.S.A.', online: false }])
const ics = 'BEGIN:VEVENT\nSUMMARY:CES 2027\nDTSTART;VALUE=DATE:20270106\nDTEND;VALUE=DATE:20270110\nURL:https://www.ces.tech\nEND:VEVENT'

const pages: Record<string, string | null> = {
  [CONFS]: confsJson,
  'https://venue.example/feed.ics': ics,
  'https://www.ces.tech': '<html><body><h1>CES</h1><p>January 6-9, 2027 Las Vegas</p></body></html>',
  'https://halfstackconf.com/phoenix': null, // unreachable -> stays unverified (0.5) -> quarantined
}
const fakeLlm = (): LlmClient & { calls: number } => { const c = { calls: 0, extract: async () => { c.calls++; return { events: [] } } }; return c as LlmClient & { calls: number } }

function deps(over: Partial<RunDeps> = {}): RunDeps & { out: Record<string, unknown> } {
  const out: Record<string, unknown> = {}
  const d: RunDeps = {
    fetchText: async (u) => (u in pages ? pages[u] : null), fetchJson: async () => null, llm: fakeLlm(), budget: new LlmBudget(300), now: () => NOW, today,
    registry: [{ id: 'venue-feed', kind: 'ical', url: 'https://venue.example/feed.ics', type: 'ical', venue: 'Las Vegas Convention Center', city: 'Las Vegas', state: 'NV' }],
    existing: [], confsYears: [2027], confsTopics: ['javascript'], tmKey: undefined, tmVenues: [],
    db: openDb(':memory:'), writeOut: (n, data) => { out[n] = data }, ...over,
  }
  return Object.assign(d, { out })
}

test('end to end: both events published (single-source ones included), report filled', async () => {
  const d = deps()
  const r = await runPipeline({ tier: 'weekly', dryRun: false, deps: d })
  expect(r.sources.map((s) => s.id).sort()).toEqual(['confs.tech', 'ticketmaster', 'venue-feed'])
  expect(r.candidates).toBe(2)
  expect(r.merged).toBe(2)
  expect(r.verified).toBe(1)
  expect(r.published).toBe(2)
  expect(r.quarantined).toBe(0)
  expect(r.allSourcesFailed).toBe(false)
  expect(loadEvents(d.db)).toHaveLength(2)
  expect(loadEvents(d.db).find((e) => e.name === 'CES 2027')).toMatchObject({ dates_confirmed: true, state: 'Nevada' })
  expect(loadEvents(d.db).find((e) => e.name === 'HalfStack Phoenix')?.dates_confirmed).toBe(false)
  expect(d.out['report.json']).toBeTruthy()
  expect(d.out['quarantine.json']).toBeTruthy()
})
test('all sources failing leaves events untouched and flags failure', async () => {
  const keep: ConfEvent = { id: 'keep', name: 'Keep', start_date: '2027-05-01', end_date: '2027-05-02', dates_confirmed: true, city: 'Austin', state: 'Texas', venue: '', organizer: '', topics: ['Tech'], est_attendance: null, official_url: 'https://keep.example', sources: [{ url: 'https://keep.example', type: 'jsonld', fetched_at: '2026-11-01T00:00:00Z' }], last_verified: '2026-11-01', confidence: 0.9, status: 'active' }
  const d = deps({ fetchText: async () => null, existing: [keep] })
  const r = await runPipeline({ tier: 'weekly', dryRun: false, deps: d })
  expect(r.allSourcesFailed).toBe(true)
  expect(loadEvents(d.db).map((e) => e.id)).toEqual(['keep'])
})
test('dry run never writes events', async () => {
  const d = deps()
  const r = await runPipeline({ tier: 'weekly', dryRun: true, deps: d })
  expect(r.published).toBe(2)
  expect(loadEvents(d.db)).toHaveLength(0)
  expect((d.db.prepare('select count(*) c from observations').get() as { c: number }).c).toBe(0)
  expect(d.out['report.json']).toBeTruthy()
})
test('LLM calls never exceed the budget', async () => {
  const llm = fakeLlm()
  const reg = [1, 2, 3, 4].map((i) => ({ id: `p${i}`, kind: 'page' as const, url: `https://p${i}.example/e`, type: 'jsonld' as const }))
  const d = deps({ llm, budget: new LlmBudget(2), registry: reg, fetchText: async (u) => (u.startsWith('https://p') ? '<html><body>Nothing</body></html>' : null) })
  const r = await runPipeline({ tier: 'weekly', dryRun: true, deps: d })
  expect(llm.calls).toBeLessThanOrEqual(2)
  expect(r.llmCalls).toBeLessThanOrEqual(2)
})
test('a source that throws is reported, not fatal', async () => {
  const d = deps({ fetchText: async (u) => { if (u === 'https://venue.example/feed.ics') throw new Error('kaboom'); return u in pages ? pages[u] : null } })
  const r = await runPipeline({ tier: 'weekly', dryRun: true, deps: d })
  expect(r.errors.join(' ')).toMatch(/venue-feed/)
  expect(r.sources.find((s) => s.id === 'venue-feed')?.ok).toBe(false)
})

test('events that have already ended are not published, verified or quarantined', async () => {
  const old = JSON.stringify([{ name: 'Old Conf', url: 'https://old.example', startDate: '2026-03-01', endDate: '2026-03-02', city: 'Austin, TX', country: 'U.S.A.', online: false }])
  const d = deps({ fetchText: async (u) => (u === CONFS ? old : u in pages ? pages[u] : null), registry: [] })
  const r = await runPipeline({ tier: 'weekly', dryRun: true, deps: d })
  expect(r.candidates).toBe(1)
  expect(r.merged).toBe(0)
  expect(r.verified).toBe(0)
  expect(r.quarantined).toBe(0)
})

test('an organizer page read in-session is verified on that page and earns organizer-site points', async () => {
  const { saveToInbox } = await import('../src/inbox')
  const { ingestBatch } = await import('../src/ingest')
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const ORG = 'https://summit.example/'
  const html = '<html><body><h1>Widget Summit 2027</h1><p>June 7-10, 2027 | Boston, MA</p></body></html>'
  const db = openDb(':memory:')
  saveToInbox(db, mkdtempSync(join(tmpdir(), 'org-')), { url: ORG, sourceId: 'summit.example', text: 'Widget Summit 2027 June 7-10, 2027 | Boston, MA' })
  ingestBatch(db, { source: { url: ORG, kind: 'organizer' }, events: [{ name: 'Widget Summit 2027', start_date: '2027-06-07', end_date: '2027-06-10', city: 'Boston', state: 'MA', evidence: 'Widget Summit 2027 June 7-10, 2027' }] }, { window: { start: '2026-11-15', end: '2027-12-31' }, today: NOW })
  const d = deps({ db, registry: [], fetchText: async (u) => (u === ORG ? html : null) })
  const r = await runPipeline({ tier: 'daily', dryRun: false, deps: d })
  expect(r.verified).toBe(1)
  const ev = loadEvents(d.db).find((e) => e.name === 'Widget Summit 2027')
  expect(ev?.dates_confirmed).toBe(true)
  const off = d.db.prepare("select confirms_edition c from observations where evidence_kind = 'official-site' and raw_name = 'Widget Summit 2027'").get() as { c: number } | undefined
  expect(off?.c).toBe(1)
})

test('an already-known organizer-page event that is still unconfirmed is re-checked on the next daily run', async () => {
  const { saveToInbox } = await import('../src/inbox')
  const { ingestBatch } = await import('../src/ingest')
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const ORG = 'https://expo.example/'
  const db = openDb(':memory:')
  saveToInbox(db, mkdtempSync(join(tmpdir(), 'org2-')), { url: ORG, sourceId: 'expo.example', text: 'Gadget Expo 2027 September 8-10, 2027 Boston' })
  ingestBatch(db, { source: { url: ORG, kind: 'organizer' }, events: [{ name: 'Gadget Expo 2027', start_date: '2027-09-08', end_date: '2027-09-10', city: 'Boston', state: 'MA', evidence: 'Gadget Expo 2027 September 8-10, 2027' }] }, { window: { start: '2026-11-15', end: '2027-12-31' }, today: NOW })
  // First run: the page is down, so the event is stored unconfirmed.
  await runPipeline({ tier: 'daily', dryRun: false, deps: deps({ db, registry: [], fetchText: async () => null }) })
  expect(loadEvents(db).find((e) => e.name === 'Gadget Expo 2027')?.dates_confirmed).toBe(false)
  // Next daily run (event is 300 days out, outside the daily window): it is still checked, and confirms.
  const html = '<html><body><h1>Gadget Expo 2027</h1><p>September 8-10, 2027, Boston</p></body></html>'
  const r = await runPipeline({ tier: 'daily', dryRun: false, deps: deps({ db, registry: [], fetchText: async (u) => (u === ORG ? html : null) }) })
  expect(r.verified).toBe(1)
  expect(loadEvents(db).find((e) => e.name === 'Gadget Expo 2027')?.dates_confirmed).toBe(true)
})
