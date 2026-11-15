import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadRegistry, runEntry, type RegistryEntry } from '../../src/sources/registry'
import { LlmBudget, type LlmClient } from '../../src/extract/llm'

const NOW = new Date('2026-11-15T12:00:00Z')
const jsonLdPage = `<script type="application/ld+json">{"@type":"Event","name":"NAB Show 2027","startDate":"2027-04-17","endDate":"2027-04-21","location":{"name":"LVCC","address":{"addressLocality":"Las Vegas","addressRegion":"NV"}}}</script>`
const plainPage = '<html><body><h1>Upcoming</h1><p>Adobe Summit 2027 runs March 23-25, 2027.</p></body></html>'
const icsText = 'BEGIN:VEVENT\nSUMMARY:Feed Conf\nDTSTART;VALUE=DATE:20270601\nDTEND;VALUE=DATE:20270603\nEND:VEVENT'

const mkLlm = (reply: unknown = []) => { const c = { calls: 0, extract: async () => { c.calls++; return reply } }; return c as LlmClient & { calls: number } }
const entry = (o: Partial<RegistryEntry> = {}): RegistryEntry => ({ id: 'lvcc', kind: 'page', url: 'https://venue.example/events', type: 'jsonld', venue: 'Las Vegas Convention Center', city: 'Las Vegas', state: 'NV', ...o })
const deps = (pages: Record<string, string | null>, llm = mkLlm()) => ({
  fetchText: async (u: string) => (u in pages ? pages[u] : null), llm, budget: new LlmBudget(10), now: () => NOW,
})

test('JSON-LD page does not call the LLM', async () => {
  const d = deps({ 'https://venue.example/events': jsonLdPage })
  const r = await runEntry(entry(), d)
  expect(d.llm.calls).toBe(0)
  expect(r.candidates).toHaveLength(1)
  expect(r.candidates[0]).toMatchObject({ name: 'NAB Show 2027', state: 'Nevada' })
  expect(r.health).toEqual({ id: 'lvcc', ok: true, count: 1 })
})
test('page without structured data but with an iCal link uses the feed, not the LLM', async () => {
  const html = '<html><head><link rel="alternate" type="text/calendar" href="/cal.ics"></head><body>x</body></html>'
  const d = deps({ 'https://venue.example/events': html, 'https://venue.example/cal.ics': icsText })
  const r = await runEntry(entry(), d)
  expect(d.llm.calls).toBe(0)
  expect(r.candidates[0]).toMatchObject({ name: 'Feed Conf', venue: 'Las Vegas Convention Center', city: 'Las Vegas', state: 'Nevada', start_date: '2027-06-01', end_date: '2027-06-02' })
})
test('page with no structured data calls the LLM exactly once', async () => {
  const llm = mkLlm([{ name: 'Adobe Summit 2027', start_date: '2027-03-23', end_date: '2027-03-25' }])
  const d = deps({ 'https://venue.example/events': plainPage }, llm)
  const r = await runEntry(entry(), d)
  expect(llm.calls).toBe(1)
  expect(r.candidates).toHaveLength(1)
  expect(r.candidates[0].source.type).toBe('llm')
})
test('ical entries parse directly', async () => {
  const r = await runEntry(entry({ kind: 'ical', url: 'https://venue.example/feed.ics' }), deps({ 'https://venue.example/feed.ics': icsText }))
  expect(r.candidates).toHaveLength(1)
})
test('fetch failure or empty result is unhealthy and never throws', async () => {
  const r1 = await runEntry(entry(), deps({ 'https://venue.example/events': null }))
  expect(r1.health.ok).toBe(false)
  expect(r1.candidates).toEqual([])
  const r2 = await runEntry(entry(), deps({ 'https://venue.example/events': '<html></html>' }))
  expect(r2.health.ok).toBe(false)
  expect(r2.health.error).toMatch(/no events/i)
})
test('aggregator candidates carry no official_url and are typed aggregator', async () => {
  const page = jsonLdPage.replace('"startDate"', '"url":"https://nabshow.com","startDate"')
  const r = await runEntry(entry({ type: 'aggregator' }), deps({ 'https://venue.example/events': page }))
  expect(r.candidates[0].official_url).toBeUndefined()
  expect(r.candidates[0].source.type).toBe('aggregator')
})
test('extra pages are fetched too', async () => {
  const d = deps({ 'https://venue.example/events': jsonLdPage, 'https://venue.example/events?page=2': jsonLdPage.replace('NAB Show 2027', 'Second Page Expo') })
  const r = await runEntry(entry({ pages: ['https://venue.example/events?page=2'] }), d)
  expect(r.candidates.map((c) => c.name).sort()).toEqual(['NAB Show 2027', 'Second Page Expo'])
})
test('loadRegistry validates the file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reg-'))
  const ok = join(dir, 'ok.yaml'); writeFileSync(ok, 'sources:\n  - {id: a, kind: page, url: "https://a.example", type: jsonld}\n')
  expect(loadRegistry(ok)).toHaveLength(1)
  const bad = join(dir, 'bad.yaml'); writeFileSync(bad, 'sources:\n  - {id: a, kind: nope}\n')
  expect(() => loadRegistry(bad)).toThrow(/Invalid registry/)
  expect(loadRegistry(join(__dirname, '../../sources/registry.yaml'))).toEqual([])
})
