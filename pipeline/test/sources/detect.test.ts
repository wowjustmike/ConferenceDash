import { readFileSync } from 'node:fs'
import { detectCalendar } from '../../src/sources/detect'

const fx = (f: string) => readFileSync(new URL(`../fixtures/${f}`, import.meta.url), 'utf8')

test('JSON-LD page -> page, count = events, no browser', () => {
  const [d] = detectCalendar(fx('event-jsonld.html'), 'https://x.example/events')
  expect(d).toMatchObject({ kind: 'page', needsBrowser: false })
  expect(d.count).toBeGreaterThan(0)
})
test('iCal link -> ical with the resolved feed URL', () => {
  const html = '<html><head><link rel="alternate" type="text/calendar" href="/feed.ics"></head><body></body></html>'
  expect(detectCalendar(html, 'https://x.example/events')[0]).toMatchObject({ kind: 'ical', icalUrl: 'https://x.example/feed.ics', needsBrowser: false })
})
test('eventItem cards with a Load More control -> loadmore (browser); without it -> page', () => {
  expect(detectCalendar(fx('dallas-items.html') + '<button>Load More Events</button>', 'https://x.example/')[0]).toMatchObject({ kind: 'loadmore', needsBrowser: true })
  expect(detectCalendar(fx('eventitems.html'), 'https://x.example/')[0]).toMatchObject({ kind: 'page', needsBrowser: false })
})
test('Simpleview convention calendar and range list are told apart and need the browser', () => {
  expect(detectCalendar(fx('simpleview-items.html') + '<div class="filter date_end"></div>', 'https://x.example/')[0]).toMatchObject({ kind: 'simpleview', needsBrowser: true })
  expect(detectCalendar(fx('occc-items.html') + '<td data-date="2026-12-01"></td>', 'https://x.example/')[0]).toMatchObject({ kind: 'simpleview-range', needsBrowser: true })
})
test('DataTables list -> datatable (browser)', () => {
  expect(detectCalendar(`<table class="dataTable">${fx('datatable-rows.html')}</table>`, 'https://x.example/')[0]).toMatchObject({ kind: 'datatable', needsBrowser: true })
})
test('generic cards with <time datetime> -> cards with derived class selectors', () => {
  const [d] = detectCalendar(fx('cards-time.html'), 'https://x.example/')
  expect(d.kind).toBe('cards')
  expect(d.count).toBe(4)
  expect(d.cards).toEqual({ item: '.ev-card', title: '.ev-card__title', date: '.ev-card__when', link: 'a' })
  expect(d.cards!.item).not.toMatch(/nth-child|#/)
})
test('generic cards with text date ranges -> cards; a fingerprint with 0 items marks needsBrowser', () => {
  expect(detectCalendar(fx('cards-text.html'), 'https://x.example/')[0]).toMatchObject({ kind: 'cards', count: 3 })
  expect(detectCalendar('<div class="dataTables_wrapper"><table class="dataTable"></table></div>', 'https://x.example/')[0]).toMatchObject({ kind: 'datatable', count: 0, needsBrowser: true })
})
test('a bigger repeated group without links loses to a smaller linked group', () => {
  const [d] = detectCalendar(fx('news-vs-events.html'), 'https://x.example/')
  expect(d.kind).toBe('cards')
  expect(d.cards!.item).toBe('.event')
})
test('nothing recognizable -> none', () => {
  expect(detectCalendar('<html><body><p>Hello</p></body></html>', 'https://x.example/')).toEqual([{ kind: 'none', count: 0, evidence: 'no calendar markup found', needsBrowser: true }])
})
test('a platform fingerprint outranks a smaller or equal JSON-LD list on the same page (JSON-LD is only the first page)', () => {
  const page = fx('event-jsonld.html').replace('</html>', '') + fx('simpleview-items.html') + '<div class="filter date_end"></div></html>'
  const [d] = detectCalendar(page, 'https://x.example/calendar')
  expect(d.kind).toBe('simpleview')
  // ...but a JSON-LD list that is clearly the full calendar still wins over an empty platform shell.
  const many = '<html>' + Array.from({ length: 12 }, (_, i) => `<script type="application/ld+json">{"@type":"Event","name":"E${i}","startDate":"2027-05-0${(i % 9) + 1}"}</script>`).join('') + '<div class="filter date_end"></div></html>'
  expect(detectCalendar(many, 'https://x.example/')[0].kind).toBe('page')
})
