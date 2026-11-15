import { readFileSync } from 'node:fs'
import { badgesFor } from './badges'
import { coordsFor } from './geo'
import { parseEvents } from './schema'

const today = new Date(2026, 10, 15)
const ev = (last_verified: string, dates_confirmed = true) => ({ last_verified, dates_confirmed }) as never

test('freshness thresholds', () => {
  expect(badgesFor(ev('2026-10-16'), today).verified).toBe('fresh') // 30 days
  expect(badgesFor(ev('2026-10-15'), today).verified).toBe('stale') // 31
  expect(badgesFor(ev('2026-10-16'), today).ageDays).toBe(30)
  expect(badgesFor(ev('2026-09-16'), today).verified).toBe('stale') // exactly 60 days
})
test('over 60 days is due', () => {
  expect(badgesFor(ev('2026-09-15'), today).verified).toBe('due') // 61
})
test('tbc flag', () => {
  expect(badgesFor(ev('2026-11-14', false), today).tbc).toBe(true)
  expect(badgesFor(ev('2026-11-14', true), today).tbc).toBe(false)
})
test('coordsFor', () => {
  expect(coordsFor('Las Vegas', 'Nevada')).not.toBeNull()
  expect(coordsFor('Nowhere', 'Nevada')).toBeNull()
})
test('every seed city has coordinates', () => {
  const { events } = parseEvents(JSON.parse(readFileSync('../data/events.json', 'utf8')))
  for (const e of events) expect(coordsFor(e.city, e.state), `${e.city}, ${e.state}`).not.toBeNull()
})
