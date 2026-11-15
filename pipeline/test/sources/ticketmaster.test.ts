import { fetchTicketmaster } from '../../src/sources/ticketmaster'

const ev = (name: string, segment: string | null, date = '2027-03-10') => ({
  name, url: `https://ticketmaster.example/${name}`, dates: { start: { localDate: date } },
  classifications: segment ? [{ segment: { name: segment } }] : [],
})
const page = (events: unknown[], totalPages = 1) => ({ _embedded: { events }, page: { totalPages } })
const venues = [{ id: 'V1', venue: 'Mandalay Bay Convention Center', city: 'Las Vegas', state: 'NV' }]

test('no key -> skipped, healthy, zero candidates, no requests', async () => {
  let calls = 0
  const r = await fetchTicketmaster(async () => { calls++; return null }, undefined, venues)
  expect(r.health).toMatchObject({ id: 'ticketmaster', ok: true, count: 0, error: 'skipped: no key' })
  expect(calls).toBe(0)
})
test('maps events to api candidates with venue info; drops music/sports/theatre; strips ticketing URL', async () => {
  const fetchJson = async () => page([ev('Expo A', 'Miscellaneous'), ev('Concert', 'Music'), ev('Game', 'Sports'), ev('Show', 'Arts & Theatre'), ev('Expo B', null)])
  const r = await fetchTicketmaster(fetchJson, 'KEY', venues)
  expect(r.candidates.map((c) => c.name)).toEqual(['Expo A', 'Expo B'])
  expect(r.candidates[0]).toMatchObject({ venue: 'Mandalay Bay Convention Center', city: 'Las Vegas', state: 'Nevada', start_date: '2027-03-10', end_date: '2027-03-10' })
  expect(r.candidates[0].official_url).toBeUndefined()
  expect(r.candidates[0].source.type).toBe('api')
  expect(r.health).toMatchObject({ ok: true, count: 2 })
})
test('paginates until totalPages and respects the size x page < 1000 cap', async () => {
  const urls: string[] = []
  const fetchJson = async (u: string) => { urls.push(u); return page([ev(`E${urls.length}`, 'Miscellaneous')], 99) }
  await fetchTicketmaster(fetchJson, 'KEY', venues)
  expect(urls).toHaveLength(5)
  expect(urls[0]).toContain('size=200')
  expect(urls[0]).toContain('venueId=V1')
  expect(urls[4]).toContain('page=4')
})
test('API error -> unhealthy, no throw', async () => {
  const r = await fetchTicketmaster(async () => null, 'KEY', venues)
  expect(r.health.ok).toBe(false)
  expect(r.candidates).toEqual([])
})
test('the API key is never included in health/error output', async () => {
  const r = await fetchTicketmaster(async () => null, 'SECRETKEY123', venues)
  expect(JSON.stringify(r.health)).not.toContain('SECRETKEY123')
})
