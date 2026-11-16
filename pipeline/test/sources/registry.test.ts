import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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
test('pages with eventItem cards use the DOM reader, not the LLM, and honor entry exclude patterns', async () => {
  const cards = '<div class="eventItem"><div class="date">Nov 20 - 29, 2026</div><h3 class="title"><a href="/e/a">Auto Show</a></h3></div><div class="eventItem"><div class="date">Dec 10, 2026</div><h3 class="title"><a href="/e/b">Holiday Party</a></h3></div>'
  const d = deps({ 'https://venue.example/events': `<html><body>${cards}</body></html>` })
  const r = await runEntry(entry({ exclude: ['party'] }), d)
  expect(d.llm.calls).toBe(0)
  expect(r.candidates.map((c) => c.name)).toEqual(['Auto Show'])
  expect(r.candidates[0].official_url).toBe('https://venue.example/e/a')
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
  const shipped = loadRegistry(join(__dirname, '../../sources/registry.yaml'))
  expect(shipped.length).toBeGreaterThan(0)
  expect(new Set(shipped.map((e) => e.id)).size).toBe(shipped.length)
})

test('simpleview entries use the browser adapter and report partial results', async () => {
  const card = (id: string, n: string) => `<article class="item convention-item" data-recid="${id}"><div class="mini-date-container"><div class="month">MAR</div><div class="day">8-11</div></div><h4 class="title">${n}</h4><h5 class="host"><a href="https://${id}.example">Org</a></h5><a class="button-default" href="https://${id}.example">Visit Website</a></article>`
  const fake = async () => ({ items: [card('a', 'HIMSS 2027'), card('b', 'Adobe Summit')], total: 5 })
  const d = { ...deps({}), browser: { withPage: async () => null }, simpleview: fake as never }
  const r = await runEntry(entry({ kind: 'simpleview', end_date: '2027-12-31' }), d)
  expect(r.candidates.map((c) => c.name)).toEqual(['HIMSS 2027', 'Adobe Summit'])
  expect(r.candidates[0]).toMatchObject({ start_date: '2027-03-08', city: 'Las Vegas', state: 'Nevada', official_url: 'https://a.example/' })
  expect(r.health).toEqual({ id: 'lvcc', ok: true, count: 2, error: 'partial: 2 of 5' })
})
test('simpleview entries without a browser are reported unhealthy, not thrown', async () => {
  const r = await runEntry(entry({ kind: 'simpleview' }), deps({}))
  expect(r.health).toMatchObject({ ok: false, error: 'browser unavailable' })
})
test('simpleview fetch failure is unhealthy', async () => {
  const d = { ...deps({}), browser: { withPage: async () => null }, simpleview: (async () => null) as never }
  expect((await runEntry(entry({ kind: 'simpleview' }), d)).health).toMatchObject({ ok: false, error: 'fetch failed' })
})

test('datatable entries use the browser adapter', async () => {
  const row = '<tr><td><a class="list-view-title" href="/e/1">Chi Expo</a></td><td><div class="multi-day-start-month-word">Mar</div><div class="multi-day-start-day-number">8</div><div class="multi-day-start-year">2027</div><div class="multi-day-end-month-word">Mar</div><div class="multi-day-end-day-number">10</div><div class="multi-day-end-year">2027</div></td></tr>'
  const d = { ...deps({}), browser: { withPage: async () => null }, datatable: (async () => ({ rows: [row], total: 40 })) as never }
  const r = await runEntry(entry({ kind: 'datatable', city: 'Chicago', state: 'IL' }), d)
  expect(r.candidates[0]).toMatchObject({ name: 'Chi Expo', start_date: '2027-03-08', end_date: '2027-03-10', state: 'Illinois' })
  expect(r.health.error).toBe('partial: 1 of 40')
})

test('expoassist entries use plain fetching and report their own id', async () => {
  const card = '<div class="grid-inner"><h3><b>Reg Expo</b></h3><span>05.03.2027 - 07.03.2027</span><a href="/events/city/x">Austin</a><a href="/event/reg-expo">d</a></div>'
  const d = deps({ 'https://expoassist.net/events/country/united-states-of-america?page=1': `<div>${card}</div>` })
  const r = await runEntry(entry({ id: 'ea', kind: 'expoassist', type: 'aggregator', url: 'https://expoassist.net/events/country/united-states-of-america' }), d)
  expect(r.health).toEqual({ id: 'ea', ok: true, count: 1 })
  expect(r.candidates[0]).toMatchObject({ name: 'Reg Expo', state: 'Texas' })
}, 20000)

test('moscone entries use the browser adapter and keep its candidates', async () => {
  const fake = async () => ({ candidates: [{ name: 'Moscone Expo', start_date: '2027-03-08', end_date: '2027-03-10', source: { url: 'u', type: 'html' as const, fetched_at: 'x' } }], health: { id: 'moscone', ok: true, count: 1 } })
  const d = { ...deps({}), browser: { withPage: async () => null }, moscone: fake as never }
  const r = await runEntry(entry({ id: 'mo', kind: 'moscone' }), d)
  expect(r.health).toEqual({ id: 'mo', ok: true, count: 1 })
  expect(r.candidates).toHaveLength(1)
  expect((await runEntry(entry({ kind: 'moscone' }), deps({}))).health.error).toBe('browser unavailable')
})

test('simpleview results whose date range was not applied are reported as a failure, not as a complete list', async () => {
  const card = '<article class="item convention-item" data-recid="a"><div class="mini-date-container"><div class="month">MAR</div><div class="day">8-11</div></div><h4 class="title">Short List Expo</h4></article>'
  const d = { ...deps({}), browser: { withPage: async () => null }, simpleview: (async () => ({ items: [card], total: 19, rangeApplied: false })) as never }
  const r = await runEntry(entry({ kind: 'simpleview' }), d)
  expect(r.candidates).toEqual([])
  expect(r.health).toEqual({ id: 'lvcc', ok: false, count: 0, error: 'date range not applied' })
})

test('loadmore entries parse every loaded card and honor category exclusions', async () => {
  const card = (n: string, c: string) => `<div class="eventItem"><div class="date">Mar. 8 - 10, 2027</div><div class="event_category">${c}</div><h3 class="title"><a href="/e/${n}">${n}</a></h3></div>`
  const d = { ...deps({}), browser: { withPage: async () => null }, loadmore: (async () => ({ html: `<div>${card('Good Show', 'Consumer Show')}${card('Big Game', 'Sporting Event')}</div>`, clicks: 3 })) as never }
  const r = await runEntry(entry({ kind: 'loadmore', exclude_categories: ['sporting event'] }), d)
  expect(r.candidates.map((c) => c.name)).toEqual(['Good Show'])
  expect(r.health).toEqual({ id: 'lvcc', ok: true, count: 1 })
})

const cardsHtml = () => readFileSync(new URL('../fixtures/cards-time.html', import.meta.url), 'utf8')
test('cards entries parse selectors and run through the DOM reader without the LLM', async () => {
  const llm = { extract: async () => { throw new Error('must not be called') } }
  const d = deps({ 'https://venue.example/events': cardsHtml() }, llm as never)
  const r = await runEntry(entry({ kind: 'cards', type: 'html', item: '.ev-card', title: '.ev-card__title', date: '.ev-card__when', city: 'Denver', state: 'CO' }), d)
  expect(r.health).toEqual({ id: 'lvcc', ok: true, count: 4 })
  expect(r.candidates[0]).toMatchObject({ name: 'Name 1', start_date: '2027-03-01', state: 'Colorado', official_url: 'https://venue.example/e/1' })
})
test('cards entry with render uses the browser render, and reports cards without a year', async () => {
  let renders = 0
  const browser = { withPage: async () => null, render: async () => { renders++; return { html: cardsHtml().replace(/<time datetime="[^"]+">/g, '<time>').replace(/, 2027/g, ''), text: '', finalUrl: 'u' } } }
  const d = { ...deps({}), browser }
  const r = await runEntry(entry({ kind: 'cards', type: 'html', item: '.ev-card', title: '.ev-card__title', date: '.ev-card__when', render: true }), d)
  expect(renders).toBe(1)
  expect(r.health).toEqual({ id: 'lvcc', ok: false, count: 0, error: 'no events found (4 cards without a year)' })
  expect((await runEntry(entry({ kind: 'cards', type: 'html', item: '.x', render: true }), deps({}))).health.error).toBe('browser unavailable')
})
