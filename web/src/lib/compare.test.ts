import { summarizeCities } from './compare'
import type { ConfEvent } from './schema'

const today = new Date(2026, 10, 15)
const mk = (id: string, city: string, s: string, e: string, att: number | null, topics: ConfEvent['topics']): ConfEvent =>
  ({ id, name: id, city, state: 'X', start_date: s, end_date: e, est_attendance: att, topics, status: 'active' }) as ConfEvent
const evs = [
  mk('ces', 'Las Vegas', '2027-01-06', '2027-01-09', 140000, ['Tech', 'Entertainment']),
  mk('nab', 'Las Vegas', '2027-04-17', '2027-04-21', 60000, ['Media', 'Tech']),
  mk('himss', 'Las Vegas', '2027-03-08', '2027-03-11', 28000, ['Healthcare', 'Tech']),
  mk('sxsw', 'Austin', '2027-03-12', '2027-03-20', null, ['Tech']),
  mk('x', 'Austin', '2027-09-01', '2027-09-02', null, ['Media']),
  mk('la', 'Los Angeles', '2027-07-01', '2027-07-04', 110000, ['Gaming']),
]

test('counts, spring window, attendees, biggest, top topics', () => {
  const [lv, au, la] = summarizeCities(evs, ['Las Vegas', 'Austin', 'Los Angeles'], today)
  expect(lv).toMatchObject({ city: 'Las Vegas', count: 3, spring: 2, attendees: 228000, biggest: 'ces' })
  expect(lv.topTopics[0]).toBe('Tech')
  expect(au).toMatchObject({ count: 2, spring: 1, attendees: null, biggest: null })
  expect(la).toMatchObject({ count: 1, spring: 0, attendees: 110000, biggest: 'la' })
})
test('cancelled events ignored; unknown city yields zero row', () => {
  const [r] = summarizeCities([{ ...evs[0], status: 'cancelled' }], ['Las Vegas'], today)
  expect(r.count).toBe(0)
  expect(summarizeCities(evs, ['Nowhere'], today)[0]).toMatchObject({ count: 0, attendees: null, biggest: null, topTopics: [] })
})
