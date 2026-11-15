import { readFileSync } from 'node:fs'
import { fetchConfsTech } from '../../src/sources/confsTech'

const fixture = readFileSync(new URL('../fixtures/confstech-javascript-2027.json', import.meta.url), 'utf8')
const base = 'https://raw.githubusercontent.com/tech-conferences/conference-data/main/conferences'

test('keeps US in-person entries, parses "City, ST", tags Tech', async () => {
  const fetchText = async (url: string) => (url === `${base}/2027/javascript.json` ? fixture : null)
  const r = await fetchConfsTech(fetchText, [2027], ['javascript'])
  expect(r.candidates.map((c) => c.name)).toEqual(['HalfStack Phoenix', 'No State City'])
  expect(r.candidates[0]).toMatchObject({ city: 'Phoenix', state: 'Arizona', start_date: '2027-02-05', end_date: '2027-02-05', official_url: 'https://halfstackconf.com/phoenix', topics: ['Tech'] })
  expect(r.candidates[0].source).toMatchObject({ type: 'confs.tech', url: `${base}/2027/javascript.json` })
  expect(r.candidates[1].state).toBeUndefined()
  expect(r.health).toMatchObject({ id: 'confs.tech', ok: true, count: 2 })
})
test('a missing topic/year file is tolerated', async () => {
  const fetchText = async (url: string) => (url.endsWith('/2027/javascript.json') ? fixture : null)
  const r = await fetchConfsTech(fetchText, [2026, 2027], ['javascript', 'devops'])
  expect(r.health.ok).toBe(true)
  expect(r.candidates).toHaveLength(2)
})
test('all files missing -> unhealthy, no candidates', async () => {
  const r = await fetchConfsTech(async () => null, [2027], ['javascript'])
  expect(r.health.ok).toBe(false)
  expect(r.candidates).toEqual([])
})
test('invalid JSON in one file does not throw', async () => {
  const r = await fetchConfsTech(async () => '{ not json', [2027], ['javascript'])
  expect(r.health.ok).toBe(false)
})
