import { groupByCity } from './mapGroups'
import type { ConfEvent } from './schema'

const mk = (id: string, city: string, state: string, att: number | null = 1000): ConfEvent =>
  ({ id, name: id, city, state, est_attendance: att, start_date: '2027-01-01', end_date: '2027-01-02' }) as ConfEvent

test('groups by city with counts and attendee sums ignoring null', () => {
  const g = groupByCity([mk('a', 'Las Vegas', 'Nevada', 100), mk('b', 'Las Vegas', 'Nevada', null), mk('c', 'Austin', 'Texas', null)])
  const lv = g.groups.find((x) => x.city === 'Las Vegas')!
  expect(lv.events).toHaveLength(2)
  expect(lv.attendees).toBe(100)
  expect(g.groups.find((x) => x.city === 'Austin')!.attendees).toBeNull()
  expect(g.unmapped).toEqual([])
})
test('unknown city goes to unmapped, no throw', () => {
  const g = groupByCity([mk('a', 'Nowhere', 'Nevada'), mk('b', 'Las Vegas', 'Nevada')])
  expect(g.unmapped.map((e) => e.id)).toEqual(['a'])
  expect(g.groups).toHaveLength(1)
})
test('Anaheim merges into the Los Angeles area', () => {
  const g = groupByCity([mk('a', 'Los Angeles', 'California'), mk('b', 'Anaheim', 'California')])
  expect(g.groups).toHaveLength(1)
  expect(g.groups[0].label).toBe('Los Angeles area')
  expect(g.groups[0].events).toHaveLength(2)
})
