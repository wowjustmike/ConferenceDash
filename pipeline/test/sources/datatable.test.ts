import { readFileSync } from 'node:fs'
import { parseDataTableRows } from '../../src/sources/datatable'

const html = readFileSync(new URL('../fixtures/datatable-rows.html', import.meta.url), 'utf8')
const rows = [...html.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => m[0])
const src = { url: 'https://www.mccormickplace.com/events/', type: 'html' as const, fetched_at: '2026-11-15T00:00:00Z' }

test('parses McCormick-style rows: title, start/end from the date blocks, venue, detail link', () => {
  const r = parseDataTableRows(rows, src, { venue: 'McCormick Place', city: 'Chicago', state: 'IL' })
  const by = (n: string) => r.find((c) => c.name.includes(n))!
  expect(by('Chi Town')).toMatchObject({ start_date: '2026-11-14', end_date: '2026-11-16', city: 'Chicago', state: 'Illinois' })
  expect(by('IEEE')).toMatchObject({ start_date: '2026-11-16', end_date: '2026-11-20' })
  expect(by('Radiological')).toMatchObject({ start_date: '2026-11-29', end_date: '2026-12-03' })
  expect(by('Chi Town').official_url).toContain('mccormickplace.com/events/?eventId=46325')
  expect(by('Chi Town').venue).toBe('McCormick Place')
})
test('single-day rows (one date block) and rows without a title or date are handled', () => {
  const single = '<tr><td><a class="list-view-title" href="/e/1">One Day Expo</a></td><td><div class="single-day"><div class="day-month-word">Mar</div><div class="day-number">5</div><div class="day-year">2027</div></div></td></tr>'
  const bad = ['<tr><td><a class="list-view-title" href="/e/2">No Dates</a></td></tr>', '<tr><td><div class="multi-day-start-month-word">Mar</div></td></tr>']
  const r = parseDataTableRows([single, ...bad], src, {})
  expect(r.map((c) => [c.name, c.start_date, c.end_date])).toEqual([['One Day Expo', '2027-03-05', '2027-03-05']])
})
