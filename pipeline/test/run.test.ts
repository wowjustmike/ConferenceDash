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

function deps(over: Partial<RunDeps> = {}): RunDeps & { written: ConfEvent[][]; out: Record<string, unknown> } {
  const written: ConfEvent[][] = []
  const out: Record<string, unknown> = {}
  const d: RunDeps = {
    fetchText: async (u) => (u in pages ? pages[u] : null), fetchJson: async () => null, llm: fakeLlm(), budget: new LlmBudget(300), now: () => NOW, today,
    registry: [{ id: 'venue-feed', kind: 'ical', url: 'https://venue.example/feed.ics', type: 'ical', venue: 'Las Vegas Convention Center', city: 'Las Vegas', state: 'NV' }],
    existing: [], confsYears: [2027], confsTopics: ['javascript'], tmKey: undefined, tmVenues: [],
    writeEvents: (e) => { written.push(e) }, writeOut: (n, data) => { out[n] = data }, ...over,
  }
  return Object.assign(d, { written, out })
}

test('end to end: verified event published, unverifiable event quarantined, report filled', async () => {
  const d = deps()
  const r = await runPipeline({ tier: 'weekly', dryRun: false, deps: d })
  expect(r.sources.map((s) => s.id).sort()).toEqual(['confs.tech', 'ticketmaster', 'venue-feed'])
  expect(r.candidates).toBe(2)
  expect(r.merged).toBe(2)
  expect(r.verified).toBe(1)
  expect(r.published).toBe(1)
  expect(r.quarantined).toBe(1)
  expect(r.allSourcesFailed).toBe(false)
  expect(d.written).toHaveLength(1)
  expect(d.written[0][0]).toMatchObject({ name: 'CES 2027', dates_confirmed: true, state: 'Nevada' })
  expect(d.out['report.json']).toBeTruthy()
  expect(d.out['quarantine.json']).toBeTruthy()
})
test('all sources failing leaves events untouched and flags failure', async () => {
  const existing = [{ id: 'keep', name: 'Keep', start_date: '2027-05-01', end_date: '2027-05-02', status: 'active' } as ConfEvent]
  const d = deps({ fetchText: async () => null, existing })
  const r = await runPipeline({ tier: 'weekly', dryRun: false, deps: d })
  expect(r.allSourcesFailed).toBe(true)
  expect(d.written).toHaveLength(0)
})
test('dry run never writes events', async () => {
  const d = deps()
  const r = await runPipeline({ tier: 'weekly', dryRun: true, deps: d })
  expect(r.published).toBe(1)
  expect(d.written).toHaveLength(0)
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
