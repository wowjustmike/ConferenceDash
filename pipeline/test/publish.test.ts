import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eventId, mergeIntoExisting, reuseId, toConfEvent, writeEventsAtomic } from '../src/publish'
import type { MergedEvent } from '../src/dedupe'
import type { ConfEvent } from '../../web/src/lib/schema'

const today = new Date(2026, 10, 15)
const mk = (o: Partial<ConfEvent> = {}): ConfEvent => ({
  id: 'ces-2027-las-vegas', name: 'CES 2027', start_date: '2027-01-06', end_date: '2027-01-09', dates_confirmed: true, city: 'Las Vegas', state: 'Nevada',
  venue: 'LVCC', organizer: 'CTA', topics: ['Tech'], est_attendance: null, official_url: 'https://www.ces.tech',
  sources: [{ url: 'https://a.example', type: 'jsonld', fetched_at: '2026-11-01T00:00:00Z' }], last_verified: '2026-11-10', confidence: 0.9, status: 'active', ...o,
})
const run = (existing: ConfEvent[], fresh: ConfEvent[], o: Partial<{ healthy: boolean; dropSeed: 'matched' | 'all' | 'none' }> = {}) =>
  mergeIntoExisting(existing, fresh, { today, healthy: true, dropSeed: 'matched', ...o })

test('empty fresh leaves existing unchanged', () => {
  const ex = [mk(), mk({ id: 'b', name: 'B' })]
  expect(run(ex, []).events).toHaveLength(2)
})
test('unhealthy run ignores fresh data entirely', () => {
  const ex = [mk({ confidence: 0.7 })]
  expect(run(ex, [mk({ name: 'CHANGED', confidence: 0.95 })], { healthy: false }).events[0].name).toBe('CES 2027')
})
test('lower-confidence fresh record does not overwrite', () => {
  const r = run([mk({ confidence: 0.9, venue: 'Good Venue' })], [mk({ confidence: 0.7, venue: 'Worse Venue' })])
  expect(r.events[0]).toMatchObject({ venue: 'Good Venue', confidence: 0.9 })
})
test('higher-confidence fresh record updates and unions sources', () => {
  const r = run([mk({ confidence: 0.7, venue: 'Old' })], [mk({ confidence: 0.9, venue: 'New', sources: [{ url: 'https://b.example', type: 'ical', fetched_at: '2026-11-12T00:00:00Z' }] })])
  expect(r.events[0].venue).toBe('New')
  expect(r.events[0].sources.map((s) => s.url).sort()).toEqual(['https://a.example', 'https://b.example'])
})
test('confirmed dates are never reverted to TBC', () => {
  const r = run([mk({ dates_confirmed: true, start_date: '2027-01-06', end_date: '2027-01-09', confidence: 0.7 })], [mk({ dates_confirmed: false, start_date: '2027-01-07', end_date: '2027-01-10', confidence: 0.9 })])
  expect(r.events[0]).toMatchObject({ dates_confirmed: true, start_date: '2027-01-06', end_date: '2027-01-09' })
})
test('ended events become past (and are counted)', () => {
  const r = run([mk({ id: 'old', start_date: '2026-10-01', end_date: '2026-10-03' })], [])
  expect(r.events[0].status).toBe('past')
  expect(r.archived).toBe(1)
})
test('below-threshold fresh events are quarantined, not published', () => {
  const r = run([], [mk({ confidence: 0.4 })])
  expect(r.events).toHaveLength(0)
  expect(r.quarantined).toHaveLength(1)
})
test('sample seed events are dropped once real events are published, kept otherwise', () => {
  const seed = mk({ id: 'seed-1', sources: [{ url: 'https://x', type: 'seed', fetched_at: '2026-11-01T00:00:00Z' }] })
  expect(run([seed], [mk()]).events.map((e) => e.id)).toEqual(['ces-2027-las-vegas'])
  expect(run([seed], []).events).toHaveLength(1)
  expect(run([seed], [mk({ confidence: 0.3 })]).events).toHaveLength(1)
})
test('ids are stable across name variants', () => {
  const base = { source: { url: 'u', type: 'ical' as const, fetched_at: 'x' }, start_date: '2027-01-06', city: 'Las Vegas' }
  expect(eventId({ ...base, name: 'CES' })).toBe(eventId({ ...base, name: 'International CES 2027' }))
  expect(eventId({ ...base, name: 'CES' })).toBe('ces-2027-las-vegas')
})
test('toConfEvent builds a valid event, or null when incomplete', () => {
  const m: MergedEvent = {
    candidate: { name: 'CES 2027', start_date: '2027-01-06', end_date: '2027-01-09', city: 'Las Vegas', state: 'Nevada', official_url: 'https://www.ces.tech', source: { url: 'https://a.example', type: 'jsonld', fetched_at: '2026-11-01T00:00:00Z' } },
    sources: [{ url: 'https://a.example', type: 'jsonld', fetched_at: '2026-11-01T00:00:00Z' }], agreeing: 2, conflictingDates: false,
  }
  const e = toConfEvent(m, { reachable: true, datesConfirmed: true, cancelled: false, cityMatches: true, editionYearSeen: true }, today)!
  expect(e).toMatchObject({ id: 'ces-2027-las-vegas', dates_confirmed: true, last_verified: '2026-11-15', status: 'active', topics: ['Tech'] })
  expect(e.confidence).toBeGreaterThanOrEqual(0.85)
  expect(toConfEvent({ ...m, candidate: { ...m.candidate, official_url: undefined } }, undefined, today)).toBeNull()
  expect(toConfEvent({ ...m, candidate: { ...m.candidate, state: undefined } }, undefined, today)).toBeNull()
  expect(toConfEvent(m, { reachable: true, datesConfirmed: false, cancelled: true, cityMatches: true, editionYearSeen: true }, today)!.status).toBe('cancelled')
})
test('writeEventsAtomic writes valid data and refuses invalid data without touching the file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pub-'))
  const path = join(dir, 'events.json')
  writeFileSync(path, '[]\n')
  writeEventsAtomic(path, [mk()])
  expect(JSON.parse(readFileSync(path, 'utf8'))).toHaveLength(1)
  const before = readFileSync(path, 'utf8')
  expect(() => writeEventsAtomic(path, [mk(), { ...mk(), name: '' }])).toThrow()
  expect(readFileSync(path, 'utf8')).toBe(before)
})

test('a cancellation is applied to the existing event even though its confidence is low', () => {
  const r = run([mk({ confidence: 0.9, dates_confirmed: true })], [mk({ status: 'cancelled', confidence: 0.2, dates_confirmed: false })])
  expect(r.events[0].status).toBe('cancelled')
  expect(r.quarantined).toHaveLength(0)
})
test('an unknown cancelled event is not published', () => {
  expect(run([], [mk({ status: 'cancelled', confidence: 0.2 })]).events).toHaveLength(0)
})
test('a later non-cancelled, higher-confidence verification restores an event', () => {
  const r = run([mk({ status: 'cancelled', confidence: 0.2 })], [mk({ status: 'active', confidence: 0.9 })])
  expect(r.events[0].status).toBe('active')
})
test('unmatched seed events survive under the matched policy and go under the all policy', () => {
  const seed = mk({ id: 'seed-x', name: 'Totally Different Expo', city: 'Austin', state: 'Texas', official_url: 'https://seed.example', sources: [{ url: 'https://x', type: 'seed', fetched_at: '2026-11-01T00:00:00Z' }] })
  expect(run([seed], [mk()], { dropSeed: 'matched' }).events.map((e) => e.id).sort()).toEqual(['ces-2027-las-vegas', 'seed-x'])
  expect(run([seed], [mk()], { dropSeed: 'all' }).events.map((e) => e.id)).toEqual(['ces-2027-las-vegas'])
  expect(run([seed], [mk()], { dropSeed: 'none' }).events).toHaveLength(2)
})
test('reuseId keeps an existing event id when the same event arrives under another name', () => {
  const existing = [mk({ id: 'invent-re-2027-las-vegas', name: 're:Invent', official_url: 'https://reinvent.awsevents.com/', city: 'Las Vegas' })]
  const c = { name: 'AWS re:Invent', start_date: '2027-01-06', end_date: '2027-01-09', city: 'Las Vegas', official_url: 'https://reinvent.awsevents.com', source: { url: 'u', type: 'jsonld' as const, fetched_at: 'x' } }
  expect(reuseId(c, existing)).toBe('invent-re-2027-las-vegas')
  expect(reuseId({ ...c, name: 'Other Thing', official_url: 'https://other.example' }, existing)).toBeNull()
  expect(reuseId({ ...c, city: 'Austin' }, existing)).toBeNull()
})
test('toConfEvent honors an id override', () => {
  const m = { candidate: { name: 'CES 2027', start_date: '2027-01-06', end_date: '2027-01-09', city: 'Las Vegas', state: 'Nevada', official_url: 'https://www.ces.tech', source: { url: 'https://a.example', type: 'jsonld' as const, fetched_at: '2026-11-01T00:00:00Z' } }, sources: [{ url: 'https://a.example', type: 'jsonld' as const, fetched_at: '2026-11-01T00:00:00Z' }], agreeing: 1, conflictingDates: false }
  expect(toConfEvent(m, undefined, today, 'my-id')!.id).toBe('my-id')
})
