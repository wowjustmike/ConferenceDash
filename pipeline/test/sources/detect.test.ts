import { readFileSync } from 'node:fs'
import { detectCalendar } from '../../src/sources/detect'
import { parseCards } from '../../src/sources/cards'

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
test('a date split into nested parts reads from the block that holds the whole range (start and end in sibling spans)', () => {
  const pa = (d1: string, d2: string, n: string) => `<div class="info clearfix"><div class="date"><span class="m-date__rangeFirst"><span class="m-date__month">Nov </span><span class="m-date__day">${d1}</span></span><span class="m-date__separator"> - </span><span class="m-date__rangeLast"><span class="m-date__day">${d2}</span><span class="m-date__year"> / 2026</span></span></div><h3 class="title"><a href="/e/${n}">${n}</a></h3></div>`
  const [d] = detectCalendar(pa('19', '22', 'A') + pa('20', '21', 'B') + pa('23', '25', 'C'), 'https://x.example/')
  expect(d).toMatchObject({ kind: 'cards', count: 3, cards: { item: '.clearfix.info', date: '.date' } })
  const ky = (s: string, e: string, n: string) => `<div class="upcoming-event"><div class="dateDiv"><div class="start-date">${s}</div><div class="separator">-</div><div class="end-date">${e}</div></div><div class="infoDiv"><a href="event?id=${n}" class="event-title">${n}</a></div></div>`
  const [k] = detectCalendar(ky('Feb 23', 'Feb 25', 'A') + ky('Jul 13', 'Jul 16', 'B') + ky('Sep 12', 'Sep 18', 'C'), 'https://x.example/')
  expect(k).toMatchObject({ kind: 'cards', cards: { item: '.upcoming-event', date: '.dateDiv' } })
})
test('title selectors that vary between cards ("title" vs "long_title title") use the classes every card shares', () => {
  const c = (t: string, n: string) => `<div class="ev"><span class="d">Nov 20 - 22, 2026</span><h3 class="${t}"><a href="/e/${n}">${n}</a></h3></div>`
  const [d] = detectCalendar(c('long_title title', 'A long name') + c('long_title title', 'B long name') + c('title', 'C') + c('long_title title', 'D'), 'https://x.example/')
  expect(d.cards!.title).toBe('.title')
})
test('cards whose class lists differ ("event-item" vs "event-item no-link") are read as one group by their shared class', () => {
  const li = (extra: string, n: string, href: string) => `<li class="event-item ${extra}"><a href="${href}"><h5 class="d">Nov ${n} - 21, 2026</h5><h3 class="t">Ev ${n}</h3></a></li>`
  const html = '<ul>' + li('', '10', '/a') + li('', '11', '/b') + li('no-link', '12', '//') + li('no-link', '13', '//') + li('no-link', '14', '//') + li('', '15', '/c') + '</ul>'
  expect(detectCalendar(html, 'https://x.example/')[0]).toMatchObject({ kind: 'cards', count: 6, cards: { item: '.event-item' } })
})
test('start and end date blocks that share a class are read together (".caldate", not ".caldate.endmo")', () => {
  const card = (s: string, e: string, n: string) => `<div class="item"><div class="caldate startmo"><span class="m">Nov</span> <span class="d">${s}</span></div><div class="caldate endmo"><span class="m">Nov</span> <span class="d">${e}</span></div><h2><a href="/c/${n}">${n}</a></h2></div>`
  const [d] = detectCalendar(card('19', '20', 'A') + card('21', '23', 'B') + card('24', '25', 'C'), 'https://x.example/')
  expect(d.cards).toMatchObject({ item: '.item', date: '.caldate' })
})
test('a class that also marks blocks nested inside each card (".row" on the card and on its inner rows) is not a card list (San Diego markup)', () => {
  const [d] = detectCalendar(fx('cards-split-dates.html'), 'https://x.example/')
  expect(d.cards).toMatchObject({ item: '.item', date: '.caldate.col-md-1' })
  expect(d.count).toBe(4)
  const p = parseCards(fx('cards-split-dates.html'), { ...d.cards!, infer_year: true }, { url: 'https://x.example/', type: 'html', fetched_at: '' }, {}, [], new Date('2026-11-16T00:00:00Z'))
  expect(p.candidates[0]).toMatchObject({ name: 'FINTECH NERDCON', start_date: '2026-11-19', end_date: '2026-11-20' })
  expect(new Set(p.candidates.map((c) => c.name)).size).toBe(p.candidates.length)
})
