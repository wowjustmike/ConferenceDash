import { readFileSync } from 'node:fs'
import { parseDateRangeText, parseEventItems } from '../../src/extract/eventitems'

const src = { url: 'https://www.laconventioncenter.com/events/', type: 'html' as const, fetched_at: '2026-11-01T00:00:00Z' }
const html = readFileSync(new URL('../fixtures/eventitems.html', import.meta.url), 'utf8')

test('parseDateRangeText handles single day, same-month, cross-month and cross-year ranges', () => {
  expect(parseDateRangeText('Nov 20 - 29, 2026')).toEqual({ start: '2026-11-20', end: '2026-11-29' })
  expect(parseDateRangeText('Dec 5, 2026')).toEqual({ start: '2026-12-05', end: '2026-12-05' })
  expect(parseDateRangeText('Nov 30 - Dec 4, 2026')).toEqual({ start: '2026-11-30', end: '2026-12-04' })
  expect(parseDateRangeText('Dec 30, 2026 - Jan 2, 2027')).toEqual({ start: '2026-12-30', end: '2027-01-02' })
  expect(parseDateRangeText('January 6–9, 2027')).toEqual({ start: '2027-01-06', end: '2027-01-09' })
  expect(parseDateRangeText('TBD')).toBeNull()
  expect(parseDateRangeText('Feb 30, 2027')).toBeNull()
  expect(parseDateRangeText('')).toBeNull()
})
test('parses eventItem cards: name, dates, absolute detail url; skips undated items', () => {
  const r = parseEventItems(html, src, { venue: 'Los Angeles Convention Center', city: 'Los Angeles', state: 'CA' })
  expect(r.map((c) => c.name)).toEqual(['LA Auto Show 2026', "Tonight's Conversation: LIVE & UNCUT", 'Cross Month Expo', 'Cross Year Summit'])
  expect(r[0]).toMatchObject({ start_date: '2026-11-20', end_date: '2026-11-29', official_url: 'https://www.laconventioncenter.com/events/detail/la-auto-show-2026', venue: 'Los Angeles Convention Center', city: 'Los Angeles', state: 'California' })
  expect(r[1].official_url).toBe('https://www.laconventioncenter.com/events/detail/live-and-uncut')
  expect(r[0].source).toEqual(src)
})
test('exclude patterns drop matching names (case-insensitive)', () => {
  const r = parseEventItems(html, src, {}, ['conversation'])
  expect(r.some((c) => /conversation/i.test(c.name))).toBe(false)
  expect(r).toHaveLength(3)
})
test('a page without event cards returns []', () => {
  expect(parseEventItems('<html><body>nothing</body></html>', src)).toEqual([])
})

describe('Carbonhouse-style cards with categories and organizer websites (Dallas)', () => {
  const dallas = readFileSync(new URL('../fixtures/dallas-items.html', import.meta.url), 'utf8')
  const dsrc = { url: 'https://www.dallasconventioncenter.com/events/', type: 'html' as const, fetched_at: '2026-11-15T00:00:00Z' }
  test('reads dotted months, the category, and prefers the Event Website link as the official url', () => {
    const r = parseEventItems(dallas, dsrc, { venue: 'Kay Bailey Hutchison Convention Center', city: 'Dallas', state: 'TX' })
    const hy = r.find((c) => /HYROX/i.test(c.name))!
    expect(hy).toMatchObject({ start_date: '2026-11-18', end_date: '2026-11-22', state: 'Texas' })
    expect(hy.official_url).toBe('https://hyrox.com/event/hyrox-dallas/')
    expect(r.find((c) => /BMW/i.test(c.name))).toBeTruthy()
  })
  test('excludeCategories drops cards whose category matches (case-insensitive)', () => {
    const r = parseEventItems(dallas, dsrc, {}, [], ['sporting event', 'special event'])
    expect(r.some((c) => /HYROX|BMW/i.test(c.name))).toBe(false)
    expect(r.some((c) => /OUTDOORS EXTRAVAGANZA/i.test(c.name))).toBe(true)
  })
})
test('parseDateRangeText accepts a slash before the year ("Nov 19 - 22 / 2026")', () => {
  expect(parseDateRangeText('Nov 19 - 22 / 2026')).toEqual({ start: '2026-11-19', end: '2026-11-22' })
  expect(parseDateRangeText('Jan 30 - Feb 2 / 2027')).toEqual({ start: '2027-01-30', end: '2027-02-02' })
})
test('parseDateRangeText accepts "to" and "through" between the dates', () => {
  expect(parseDateRangeText('Oct 23, 2026 to Nov 22, 2026')).toEqual({ start: '2026-10-23', end: '2026-11-22' })
  expect(parseDateRangeText('Nov 16 through 18, 2026')).toEqual({ start: '2026-11-16', end: '2026-11-18' })
})
