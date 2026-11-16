import { dueForVerification } from '../src/schedule'
import type { ConfEvent } from '../../web/src/lib/schema'

const today = new Date(2026, 10, 15)
const ev = (start: string, o: Partial<ConfEvent> = {}) => ({ start_date: start, end_date: start, status: 'active', ...o }) as ConfEvent

test('events within 30 days are due on every tier', () => {
  for (const t of ['daily', 'weekly', 'monthly'] as const) expect(dueForVerification(ev('2026-11-25'), today, t)).toBe(true)
})
test('31-180 days: weekly and monthly only', () => {
  const e = ev('2027-02-15')
  expect(dueForVerification(e, today, 'daily')).toBe(false)
  expect(dueForVerification(e, today, 'weekly')).toBe(true)
  expect(dueForVerification(e, today, 'monthly')).toBe(true)
})
test('beyond 180 days: monthly only', () => {
  const e = ev('2027-09-15')
  expect(dueForVerification(e, today, 'daily')).toBe(false)
  expect(dueForVerification(e, today, 'weekly')).toBe(false)
  expect(dueForVerification(e, today, 'monthly')).toBe(true)
})
test('past, cancelled and already-ended events are never due', () => {
  expect(dueForVerification(ev('2026-11-25', { status: 'past' }), today, 'monthly')).toBe(false)
  expect(dueForVerification(ev('2026-11-25', { status: 'cancelled' }), today, 'monthly')).toBe(false)
  expect(dueForVerification(ev('2026-10-01'), today, 'monthly')).toBe(false)
})
test('an event in progress today is due', () => {
  expect(dueForVerification(ev('2026-11-14', { end_date: '2026-11-16' }), today, 'daily')).toBe(true)
})
