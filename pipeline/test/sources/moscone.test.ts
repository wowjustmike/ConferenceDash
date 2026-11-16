import { readFileSync } from 'node:fs'
import { parseMosconeDetail } from '../../src/sources/moscone'

const text = readFileSync(new URL('../fixtures/moscone-detail.txt', import.meta.url), 'utf8')

test('reads the date range from a Moscone event page', () => {
  expect(parseMosconeDetail(text)).toEqual({ start: '2026-11-01', end: '2026-11-04' })
})
test.each([
  ['IN-PERSON | March 8-11, 2027 | Moscone Center', '2027-03-08', '2027-03-11'],
  ['Moscone Center | Dec 30, 2026 - Jan 2, 2027 | San Francisco', '2026-12-30', '2027-01-02'],
  ['Join us May 3, 2027 in San Francisco', '2027-05-03', '2027-05-03'],
  ['June 28 - July 1, 2027', '2027-06-28', '2027-07-01'],
])('parses "%s"', (t, start, end) => {
  expect(parseMosconeDetail(t)).toEqual({ start, end })
})
test('returns null when no date range is present', () => {
  expect(parseMosconeDetail('Welcome to The Moscone Center! No dates here.')).toBeNull()
})
