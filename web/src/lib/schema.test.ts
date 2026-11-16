import { readFileSync } from 'node:fs'
import { parseEvents, TOPICS } from './schema'

const base = {
  id: 'a-2027', name: 'A', start_date: '2027-01-06', end_date: '2027-01-09', dates_confirmed: true,
  city: 'Las Vegas', state: 'Nevada', venue: 'V', organizer: 'O', topics: ['Tech'], est_attendance: null,
  official_url: 'https://a.example', sources: [{ url: 'https://a.example', type: 'seed', fetched_at: '2026-11-01T00:00:00Z' }],
  last_verified: '2026-11-01', confidence: 0.9, status: 'active',
}

test('valid array parses', () => {
  const r = parseEvents([base, { ...base, id: 'b' }])
  expect(r.events).toHaveLength(2)
  expect(r.skipped).toBe(0)
})
test('entry missing name is skipped with a warning', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const { name: _n, ...bad } = base
  const r = parseEvents([base, bad])
  expect(r.events).toHaveLength(1)
  expect(r.skipped).toBe(1)
  expect(warn).toHaveBeenCalled()
  warn.mockRestore()
})
test('non-array input yields no events', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  expect(parseEvents({}).events).toEqual([])
})
test('unknown topic rejected', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  expect(parseEvents([{ ...base, topics: ['Bogus'] }]).skipped).toBe(1)
})
test('end before start rejected', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  expect(parseEvents([{ ...base, end_date: '2027-01-01' }]).skipped).toBe(1)
})
test('cancelled status still parses', () => {
  expect(parseEvents([{ ...base, status: 'cancelled' }]).events[0].status).toBe('cancelled')
})
test('taxonomy has 16 topics', () => { expect(TOPICS).toHaveLength(16) })
test('seed data parses with skipped === 0', () => {
  const raw = JSON.parse(readFileSync('src/test-data/seed-events.json', 'utf8'))
  const r = parseEvents(raw)
  expect(r.skipped).toBe(0)
  expect(r.events.length).toBe(24)
})

test('non-http(s) official_url is rejected', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  for (const u of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x'])
    expect(parseEvents([{ ...base, official_url: u }]).skipped).toBe(1)
  expect(parseEvents([{ ...base, official_url: 'http://ok.example' }]).skipped).toBe(0)
})
