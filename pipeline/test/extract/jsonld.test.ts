import { readFileSync } from 'node:fs'
import { parseJsonLd } from '../../src/extract/jsonld'

const src = { url: 'https://venue.example/events', type: 'jsonld' as const, fetched_at: '2026-11-01T00:00:00Z' }
const html = readFileSync(new URL('../fixtures/event-jsonld.html', import.meta.url), 'utf8')
const all = parseJsonLd(html, src)

test('single Event subtype with place, region and organizer', () => {
  expect(all.find((c) => c.name === 'NAB Show 2027')).toMatchObject({
    start_date: '2027-04-17', end_date: '2027-04-21', official_url: 'https://nabshow.com', venue: 'Las Vegas Convention Center',
    city: 'Las Vegas', state: 'Nevada', organizer: 'National Association of Broadcasters', source: src,
  })
})
test('@graph with multi-typed event, datetime start, string address', () => {
  const g = all.find((c) => c.name === 'Graph Fest')!
  expect(g).toMatchObject({ start_date: '2027-06-01', end_date: '2027-06-01', venue: 'Hall' })
  expect(g.city).toBe('Austin')
  expect(g.state).toBe('Texas')
})
test('ItemList of events', () => {
  expect(all.find((c) => c.name === 'List Expo')).toMatchObject({ start_date: '2027-07-01', end_date: '2027-07-03', city: 'Orlando', state: 'Florida' })
})
test('non-event nodes and invalid JSON are skipped without throwing', () => {
  expect(all).toHaveLength(3)
})
test('page with no JSON-LD returns []', () => {
  expect(parseJsonLd('<html><body>hi</body></html>', src)).toEqual([])
})
test('events with non-http url drop the url; invalid dates drop the event', () => {
  const h = `<script type="application/ld+json">[{"@type":"Event","name":"A","startDate":"2027-01-01","url":"javascript:alert(1)"},{"@type":"Event","name":"B","startDate":"nope"}]</script>`
  const r = parseJsonLd(h, src)
  expect(r).toHaveLength(1)
  expect(r[0].official_url).toBeUndefined()
})
