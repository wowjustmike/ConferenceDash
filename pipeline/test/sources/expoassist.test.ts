import { readFileSync } from 'node:fs'
import { fetchExpoAssist, parseExpoAssist } from '../../src/sources/expoassist'

const html = readFileSync(new URL('../fixtures/expoassist-cards.html', import.meta.url), 'utf8')
const src = { url: 'https://expoassist.net/events/country/united-states-of-america', type: 'aggregator' as const, fetched_at: '2026-11-15T00:00:00Z' }

test('parses cards: title, DD.MM.YYYY dates, city (state looked up), detail link on expoassist as the listing', () => {
  const r = parseExpoAssist(html, src)
  expect(r.length).toBeGreaterThanOrEqual(3)
  const by = (n: string) => r.find((c) => c.name.includes(n))!
  expect(by('ISSA')).toMatchObject({ start_date: '2026-11-17', end_date: '2026-11-19', city: 'Las Vegas', state: 'Nevada' })
  expect(by('Los Angeles Auto Show')).toMatchObject({ start_date: '2026-11-20', end_date: '2026-11-29', city: 'Los Angeles', state: 'California' })
  expect(by('GNYDM')).toMatchObject({ city: 'New York', state: 'New York' })
  expect(r.every((c) => c.source.type === 'aggregator')).toBe(true)
  expect(by('ISSA').source.url).toBe('https://expoassist.net/event/issa-show-north-america-exhibition') // each event links to its own page
  // an aggregator's own page is never presented as the organizer's official site
  expect(r.every((c) => c.official_url === undefined)).toBe(true)
})
test('skips cards with unknown cities or bad dates', () => {
  const card = (name: string, date: string, city: string) => `<div class="grid-inner"><h3><b>${name}</b></h3><span>${date}</span><a href="/events/city/x">${city}</a></div>`
  const r = parseExpoAssist(`<div>${card('Good Expo', '05.03.2027 - 07.03.2027', 'Austin')}${card('Nowhere Expo', '05.03.2027 - 07.03.2027', 'Atlantis')}${card('Bad Date Expo', '35.13.2027 - 07.03.2027', 'Austin')}</div>`, src)
  expect(r.map((c) => c.name)).toEqual(['Good Expo'])
})
test('fetchExpoAssist walks pages until a page adds nothing new, and tolerates failures', async () => {
  const page = (names: string[]) => names.map((n) => `<div class="grid-inner"><h3><b>${n}</b></h3><span>05.03.2027 - 07.03.2027</span><a href="/events/city/x">Austin</a></div>`).join('')
  const pages: Record<string, string | null> = { '1': page(['A Expo', 'B Expo']), '2': page(['C Expo']), '3': page(['C Expo']) }
  const seen: string[] = []
  const r = await fetchExpoAssist(async (u) => { const p = new URL(u).searchParams.get('page') ?? '1'; seen.push(p); return pages[p] ?? null }, 'https://expoassist.net/events/country/united-states-of-america', 10)
  expect(r.candidates.map((c) => c.name)).toEqual(['A Expo', 'B Expo', 'C Expo'])
  expect(seen).toEqual(['1', '2', '3'])
  expect(r.health).toEqual({ id: 'expoassist-us', ok: true, count: 3 })
  const bad = await fetchExpoAssist(async () => null, 'https://expoassist.net/events/country/united-states-of-america', 3)
  expect(bad.health.ok).toBe(false)
})
