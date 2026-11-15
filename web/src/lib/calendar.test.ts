import { weekRows } from './calendar'
import type { ConfEvent } from './schema'

const mk = (id: string, s: string, e: string): ConfEvent => ({ id, name: id, start_date: s, end_date: e }) as ConfEvent

test('Mar 12-20 2027 splits into two week rows', () => {
  const rows = weekRows([mk('sxsw', '2027-03-12', '2027-03-20')], 2027, 2)
  const hit = rows.filter((r) => r.segments.some((s) => s.event.id === 'sxsw'))
  expect(hit).toHaveLength(2)
  const [a, b] = hit.map((r) => r.segments.find((s) => s.event.id === 'sxsw')!)
  expect(a.startCol).toBe(5); expect(a.endCol).toBe(6); expect(a.continuesRight).toBe(true)
  expect(b.startCol).toBe(0); expect(b.endCol).toBe(6); expect(b.continuesLeft).toBe(true)
})
test('event spanning Feb 27 - Mar 3 shows in both months', () => {
  const e = [mk('x', '2027-02-27', '2027-03-03')]
  const has = (m: number) => weekRows(e, 2027, m).some((r) => r.segments.length > 0)
  expect(has(1)).toBe(true)
  expect(has(2)).toBe(true)
  expect(has(3)).toBe(false)
})
test('overlapping events get different lanes', () => {
  const rows = weekRows([mk('a', '2027-03-08', '2027-03-11'), mk('b', '2027-03-09', '2027-03-10')], 2027, 2)
  const r = rows.find((x) => x.segments.length === 2)!
  expect(new Set(r.segments.map((s) => s.lane)).size).toBe(2)
})
test('very long event (3 weeks) still renders every week row', () => {
  const rows = weekRows([mk('long', '2027-03-01', '2027-03-25')], 2027, 2)
  expect(rows.filter((r) => r.segments.length).length).toBeGreaterThanOrEqual(4)
})
