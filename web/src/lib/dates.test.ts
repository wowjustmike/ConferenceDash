import { parseLocalDate, formatRange, daysUntil, presetRange, overlaps } from './dates'

const today = new Date(2026, 10, 15) // Nov 15 2026 local

test('parseLocalDate does not shift the day in LA time zone', () => {
  const d = parseLocalDate('2027-01-06')
  expect(d.getDate()).toBe(6)
  expect(d.getMonth()).toBe(0)
  expect(d.getHours()).toBe(0)
})
test('formatRange same month', () => { expect(formatRange('2027-01-06', '2027-01-09')).toBe('Jan 6-9, 2027') })
test('formatRange cross month', () => { expect(formatRange('2026-11-30', '2026-12-04')).toBe('Nov 30 - Dec 4, 2026') })
test('formatRange single day', () => { expect(formatRange('2027-01-06', '2027-01-06')).toBe('Jan 6, 2027') })
test('formatRange cross year', () => { expect(formatRange('2026-12-30', '2027-01-02')).toBe('Dec 30, 2026 - Jan 2, 2027') })
test('daysUntil counts whole days', () => {
  expect(daysUntil('2026-11-20', today)).toBe(5)
  expect(daysUntil('2026-11-15', today)).toBe(0)
})
test('presetRange', () => {
  expect(presetRange('any', today)).toBeNull()
  const n30 = presetRange('next30', today)!
  expect(daysUntil(n30.to.toISOString().slice(0, 10), today)).toBeGreaterThanOrEqual(29)
  const q = presetRange('quarter', today)!
  expect(q.from.getMonth()).toBe(9) // Oct 1 (Q4)
  expect(q.to.getMonth()).toBe(11)
  expect(presetRange('next12', today)!.to.getFullYear()).toBe(2027)
})
test('overlaps true when event starts before range but ends inside', () => {
  const ev = { start_date: '2026-11-10', end_date: '2026-11-18' }
  expect(overlaps(ev, new Date(2026, 10, 15), new Date(2026, 10, 30))).toBe(true)
  expect(overlaps(ev, new Date(2026, 10, 19), new Date(2026, 10, 30))).toBe(false)
})
