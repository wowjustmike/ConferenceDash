import { normalizeState, normalizeCity, normalizeVenue, normalizeDate, guessTopics, toCandidateClean } from '../src/normalize'
import type { Candidate } from '../src/types'

const src = { url: 'https://x.example', type: 'ical' as const, fetched_at: '2026-11-01T00:00:00Z' }
const cand = (o: Partial<Candidate>): Candidate => ({ name: 'Ev', source: src, ...o })

test('normalizeState', () => {
  expect(normalizeState('NV')).toBe('Nevada')
  expect(normalizeState('nv')).toBe('Nevada')
  expect(normalizeState(' Nevada ')).toBe('Nevada')
  expect(normalizeState('Atlantis')).toBeNull()
  expect(normalizeState('DC')).toBe('District of Columbia')
})
test('normalizeCity applies aliases and trims', () => {
  expect(normalizeCity('  vegas ')).toBe('Las Vegas')
  expect(normalizeCity('los angeles')).toBe('Los Angeles')
  expect(normalizeCity('LAS VEGAS')).toBe('Las Vegas')
})
test('normalizeVenue applies aliases', () => {
  expect(normalizeVenue('LVCC')).toBe('Las Vegas Convention Center')
  expect(normalizeVenue('  Moscone Center ')).toBe('Moscone Center')
})
test('normalizeDate', () => {
  expect(normalizeDate('Jan 6, 2027')).toBe('2027-01-06')
  expect(normalizeDate('January 6, 2027')).toBe('2027-01-06')
  expect(normalizeDate('6 January 2027')).toBe('2027-01-06')
  expect(normalizeDate('2027-01-06')).toBe('2027-01-06')
  expect(normalizeDate('2027-01-06T09:00:00-08:00')).toBe('2027-01-06')
  expect(normalizeDate('2027-02-30')).toBeNull()
  expect(normalizeDate('soon')).toBeNull()
  expect(normalizeDate('')).toBeNull()
})
test('guessTopics', () => {
  expect(guessTopics('Black Hat USA')).toContain('Tech')
  expect(guessTopics('MJBizCon')).toContain('Cannabis')
  expect(guessTopics('National Restaurant Association Show')).toContain('Hospitality')
  expect(guessTopics('Quilt Market')).toEqual(['Other'])
})
test('toCandidateClean', () => {
  expect(toCandidateClean(cand({ name: '' }))).toBeNull()
  expect(toCandidateClean(cand({ start_date: '2027-01-09', end_date: '2027-01-06' }))).toBeNull()
  expect(toCandidateClean(cand({ start_date: 'garbage' }))).toBeNull()
  const c = toCandidateClean(cand({ name: ' CES ', start_date: 'Jan 6, 2027', city: 'vegas', state: 'nv', venue: 'LVCC' }))!
  expect(c).toMatchObject({ name: 'CES', start_date: '2027-01-06', end_date: '2027-01-06', city: 'Las Vegas', state: 'Nevada', venue: 'Las Vegas Convention Center' })
  expect(toCandidateClean(cand({ state: 'Atlantis' }))!.state).toBeUndefined()
})
