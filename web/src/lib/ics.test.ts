import { buildIcs } from './ics'
import type { ConfEvent } from './schema'

const ev = { id: 'a', name: 'CES 2027', start_date: '2027-01-06', end_date: '2027-01-09', city: 'Las Vegas', state: 'Nevada', venue: 'LVCC', official_url: 'https://www.ces.tech' } as ConfEvent

test('ics has all-day start, exclusive end, summary, location and url', () => {
  const s = buildIcs(ev)
  expect(s).toContain('BEGIN:VCALENDAR')
  expect(s).toContain('DTSTART;VALUE=DATE:20270106')
  expect(s).toContain('DTEND;VALUE=DATE:20270110')
  expect(s).toContain('SUMMARY:CES 2027')
  expect(s).toContain('LOCATION:LVCC\\, Las Vegas\\, Nevada')
  expect(s).toContain('URL:https://www.ces.tech')
})
test('ics end date rolls over month boundaries', () => {
  expect(buildIcs({ ...ev, start_date: '2026-11-30', end_date: '2026-12-31' })).toContain('DTEND;VALUE=DATE:20270101')
})

test('semicolons and commas in text fields are escaped', () => {
  const s = buildIcs({ ...ev, name: 'Foo; Bar' })
  expect(s).toContain('SUMMARY:Foo\; Bar')
})
test('DTSTAMP is a UTC timestamp', () => {
  expect(buildIcs(ev)).toMatch(/DTSTAMP:\d{8}T\d{6}Z/)
})
