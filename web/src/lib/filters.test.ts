import type { ConfEvent } from './schema'
import { applyFilters, facetCounts, citiesForStates, sortEvents, EMPTY_FILTERS, type Filters } from './filters'

const today = new Date(2026, 10, 15)
let n = 0
const ev = (o: Partial<ConfEvent>): ConfEvent => ({
  id: `e${++n}`, name: 'Ev', start_date: '2027-01-06', end_date: '2027-01-09', dates_confirmed: true,
  city: 'Las Vegas', state: 'Nevada', venue: 'LVCC', organizer: 'Org', topics: ['Tech'], est_attendance: 20000,
  official_url: 'https://x.example', sources: [], last_verified: '2026-11-01', confidence: 0.9, status: 'active', ...o,
})
const F = (o: Partial<Filters>): Filters => ({ ...EMPTY_FILTERS, preset: 'any', ...o })

const lv = ev({ id: 'lv-tech', name: 'CES', organizer: 'CTA' })
const lvHealth = ev({ id: 'lv-health', name: 'HIMSS', topics: ['Healthcare'], venue: 'Venetian Expo', est_attendance: 28000 })
const la = ev({ id: 'la-tech', city: 'Los Angeles', state: 'California', venue: 'LACC', est_attendance: null })
const tx = ev({ id: 'tx', city: 'Austin', state: 'Texas', topics: ['Media', 'Tech'], est_attendance: 90000 })
const cancelled = ev({ id: 'x', status: 'cancelled' })
const past = ev({ id: 'p', status: 'past' })
const all = [lv, lvHealth, la, tx, cancelled, past]
const ids = (l: ConfEvent[]) => l.map((e) => e.id).sort()

test('state+city+topic combination', () => {
  const r = applyFilters(all, F({ states: ['Nevada', 'California'], cities: ['Las Vegas'], topics: ['Tech'] }), today)
  expect(ids(r)).toEqual(['lv-tech'])
})
test('cancelled and past are never returned', () => {
  expect(ids(applyFilters(all, F({}), today))).toEqual(['la-tech', 'lv-health', 'lv-tech', 'tx'])
})
test('q matches name, venue, organizer case-insensitively', () => {
  expect(ids(applyFilters(all, F({ q: 'ces' }), today))).toEqual(['lv-tech'])
  expect(ids(applyFilters(all, F({ q: 'VENETIAN' }), today))).toEqual(['lv-health'])
  expect(ids(applyFilters(all, F({ q: 'cta' }), today))).toEqual(['lv-tech'])
})
test('multi-topic event matches any selected topic', () => {
  expect(ids(applyFilters(all, F({ topics: ['Media'] }), today))).toEqual(['tx'])
})
test('null attendance excluded only when sizes selected', () => {
  expect(ids(applyFilters(all, F({ states: ['California'] }), today))).toEqual(['la-tech'])
  expect(ids(applyFilters(all, F({ states: ['California'], sizes: ['u10k'] }), today))).toEqual([])
  expect(ids(applyFilters(all, F({ sizes: ['75k+'] }), today))).toEqual(['tx'])
  expect(ids(applyFilters(all, F({ sizes: ['10-30k'] }), today))).toEqual(['lv-health', 'lv-tech'])
})
test('date preset hides events outside the window', () => {
  expect(applyFilters(all, F({ preset: 'next30' }), today)).toEqual([])
  expect(applyFilters(all, F({ preset: 'next12' }), today)).toHaveLength(4)
})
test('custom range', () => {
  expect(applyFilters(all, F({ preset: 'custom', from: '2027-01-08', to: '2027-02-01' }), today)).toHaveLength(4)
  expect(applyFilters(all, F({ preset: 'custom', from: '2027-02-01', to: '2027-03-01' }), today)).toHaveLength(0)
})
test('facetCounts ignores the facet being counted', () => {
  const c = facetCounts(all, F({ states: ['Nevada'] }), today, 'state')
  expect(c.get('California')).toBe(1)
  expect(c.get('Nevada')).toBe(2)
})
test('facetCounts still respects other filters', () => {
  const c = facetCounts(all, F({ topics: ['Healthcare'] }), today, 'state')
  expect(c.get('Nevada')).toBe(1)
  expect(c.get('California')).toBeUndefined()
})
test('topic facet counts each topic of multi-topic events', () => {
  const c = facetCounts(all, F({}), today, 'topic')
  expect(c.get('Tech')).toBe(3)
  expect(c.get('Media')).toBe(1)
})
test('citiesForStates only returns cities in chosen states', () => {
  expect(citiesForStates(all, ['Nevada'])).toEqual(['Las Vegas'])
  expect(citiesForStates(all, ['Nevada', 'Texas'])).toEqual(['Austin', 'Las Vegas'])
  expect(citiesForStates(all, [])).toEqual(['Austin', 'Las Vegas', 'Los Angeles'])
})
test('sortEvents', () => {
  const a = sortEvents([lv, la, tx], 'attendance').map((e) => e.id)
  expect(a).toEqual(['tx', 'lv-tech', 'la-tech'])
  expect(sortEvents([tx, lv], 'name').map((e) => e.name)).toEqual(['CES', 'Ev'])
  const d = sortEvents([ev({ id: 'late', start_date: '2027-05-01', end_date: '2027-05-02' }), lv], 'date')
  expect(d[0].id).toBe('lv-tech')
})
