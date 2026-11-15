import { readFileSync } from 'node:fs'
import { parseIcs } from '../../src/extract/ical'

const src = { url: 'https://cal.example/feed.ics', type: 'ical' as const, fetched_at: '2026-11-01T00:00:00Z' }
const text = readFileSync(new URL('../fixtures/sample.ics', import.meta.url), 'utf8')

test('all-day multi-day event uses an exclusive DTEND', () => {
  const ces = parseIcs(text, src).find((c) => c.name === 'CES 2027')!
  expect(ces.start_date).toBe('2027-01-06')
  expect(ces.end_date).toBe('2027-01-09')
  expect(ces.official_url).toBe('https://www.ces.tech')
  expect(ces.organizer).toBe('Consumer Technology Association')
  expect(ces).toMatchObject({ venue: 'Las Vegas Convention Center', city: 'Las Vegas', state: 'Nevada' })
  expect(ces.source).toEqual(src)
})
test('all-day event without DTEND is a single day', () => {
  const e = parseIcs(text, src).find((c) => c.name === 'One Day Summit')!
  expect([e.start_date, e.end_date]).toEqual(['2027-03-01', '2027-03-01'])
})
test('timed events keep inclusive end date; folded lines unfold; defaults fill location', () => {
  const e = parseIcs(text, src, { venue: 'Hall X', city: 'Austin', state: 'TX' }).find((c) => c.name === 'TimedEvent Folded' || c.name.startsWith('Timed'))!
  expect(e.name).toBe('Timed Event Folded')
  expect([e.start_date, e.end_date]).toEqual(['2027-04-15', '2027-04-17'])
  expect(e).toMatchObject({ venue: 'Hall X', city: 'Austin', state: 'Texas' })
})
test('VEVENT without SUMMARY is skipped', () => {
  expect(parseIcs(text, src)).toHaveLength(3)
})
test('garbage and empty input return [] without throwing', () => {
  expect(parseIcs('', src)).toEqual([])
  expect(parseIcs('not an ics file <html>', src)).toEqual([])
  expect(parseIcs('BEGIN:VEVENT\nSUMMARY:x\nDTSTART:zzz\nEND:VEVENT', src)).toEqual([])
})
