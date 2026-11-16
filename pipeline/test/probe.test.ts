import { readFileSync } from 'node:fs'
import { entryId, entryYaml, probeUrl, type ProbeDeps } from '../src/probe'

const fx = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')
const deps = (o: Partial<ProbeDeps> & { html?: string | null; status?: number | null }): ProbeDeps => {
  const { html, status, ...rest } = o
  return {
    canFetch: async () => true, fetchText: async () => html ?? null, lastStatus: () => (status !== undefined ? status : html ? 200 : null),
    now: () => new Date('2026-11-16T00:00:00Z'), ...rest,
  }
}
const noBrowser = () => ({ render: vi.fn(async () => null), withPage: vi.fn(async () => null) })

test('robots disallow -> blocked, no fetch, no browser', async () => {
  const fetchText = vi.fn(async () => null)
  const r = await probeUrl('https://x.example/events', deps({ canFetch: async () => false, fetchText }))
  expect(r.verdict).toBe('blocked: robots.txt')
  expect(fetchText).not.toHaveBeenCalled()
  expect(r.entry).toBeNull()
})
test('HTTP 403/429 -> blocked: bot protection, browser never used', async () => {
  const browser = noBrowser()
  const r = await probeUrl('https://x.example/events', deps({ html: null, status: 403, browser }))
  expect(r.verdict).toBe('blocked: bot protection')
  expect(browser.render).not.toHaveBeenCalled()
  expect((await probeUrl('https://x.example/events', deps({ html: null, status: 429 }))).verdict).toBe('blocked: bot protection')
})
test('static JSON-LD page -> ok, kind page, entry without render, sample <= 5, browser not used', async () => {
  const browser = noBrowser()
  const r = await probeUrl('https://x.example/events', deps({ html: fx('event-jsonld.html'), browser }), { city: 'Denver', state: 'CO' })
  expect(r.verdict).toBe('ok')
  expect(r.entry).toMatchObject({ id: 'x', kind: 'page', type: 'html', url: 'https://x.example/events', city: 'Denver', state: 'CO' })
  expect(r.entry).not.toHaveProperty('render')
  expect(r.sample.length).toBeLessThanOrEqual(5)
  expect(r.sample.length).toBeGreaterThan(0)
  expect(r.usedBrowser).toBe(false)
  expect(browser.render).not.toHaveBeenCalled()
})
test('script-filled list -> browser render, then cards detection', async () => {
  const browser = { render: vi.fn(async () => ({ html: fx('cards-time.html'), text: '', finalUrl: 'https://x.example/events' })), withPage: vi.fn(async () => null) }
  const r = await probeUrl('https://x.example/events', deps({ html: '<div class="dataTables_wrapper"><table class="dataTable"></table></div>', browser }))
  expect(r.usedBrowser).toBe(true)
  expect(r.verdict).toBe('ok')
  expect(r.count).toBe(4)
  expect(r.entry).toMatchObject({ kind: 'cards', render: true, item: '.ev-card', title: '.ev-card__title', date: '.ev-card__when' })
  expect(r.sample[0]).toMatchObject({ name: 'Name 1', start_date: '2027-03-01', end_date: '2027-03-02', official_url: 'https://x.example/e/1' })
})
test('cards without years -> needs reader', async () => {
  const html = '<div class="c"><span class="t">X</span><span class="d">Nov 20 - 29</span><a href="/x">x</a></div>'.repeat(3)
  const r = await probeUrl('https://x.example/', deps({ html }))
  expect(r.verdict).toBe('needs reader')
  expect(r.entry).toBeNull()
})
test('no markup and no browser -> nothing found; unreachable when fetch returns null with no status', async () => {
  expect((await probeUrl('https://x.example/', deps({ html: '<p>hi</p>' }))).verdict).toBe('nothing found')
  expect((await probeUrl('https://x.example/', deps({ html: null, status: null }))).verdict).toBe('unreachable')
})
test('events already over do not count; the window is now..now+2y', async () => {
  const html = fx('cards-time.html').replace(/2027-03/g, '2025-03')
  const r = await probeUrl('https://x.example/', deps({ html }))
  expect(r.count).toBe(0)
  expect(r.rejected).toBe(4)
  expect(r.verdict).toBe('nothing found')
})
test('entryId and entryYaml', () => {
  expect(entryId('https://www.denverconvention.com/events/')).toBe('denverconvention')
  expect(entryId('https://events.visitphoenix.org/calendar')).toBe('events-visitphoenix')
  expect(entryYaml({ id: 'a', kind: 'cards', type: 'html', url: 'https://a.example/', item: '.c' })).toBe("  - id: a\n    kind: cards\n    type: html\n    url: https://a.example/\n    item: '.c'\n")
})
