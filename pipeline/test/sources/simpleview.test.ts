import { existsSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createBrowserFetcher } from '../../src/net/browser'
import { collectPaged, parseSimpleviewItems } from '../../src/sources/simpleview'

const html = readFileSync(new URL('../fixtures/simpleview-items.html', import.meta.url), 'utf8')
const src = { url: 'https://www.vegasmeansbusiness.com/destination-calendar/', type: 'html' as const, fetched_at: '2026-11-15T00:00:00Z' }
const today = new Date(2026, 10, 15)

test('parses convention cards: dates (year inferred), title, organizer, venue, attendance, organizer website', () => {
  const items = [...html.matchAll(/<article[\s\S]*?<\/article>/g)].map((m) => m[0])
  const r = parseSimpleviewItems(items, src, today, { city: 'Las Vegas', state: 'NV' })
  const by = (n: string) => r.find((c) => c.name.includes(n))!
  expect(by('DesignerCon')).toMatchObject({ name: 'DesignerCon 2026', start_date: '2026-11-13', end_date: '2026-11-15', venue: 'The Expo at World Market Center Las Vegas', organizer: 'DesignerCon', est_attendance: 40000, city: 'Las Vegas', state: 'Nevada' })
  expect(by('DesignerCon').official_url).toBe('http://www.designercon.com/')
  expect(by('HLTH')).toMatchObject({ start_date: '2026-11-15', end_date: '2026-11-18', est_attendance: 10000 })
  expect(by('ISSA')).toMatchObject({ start_date: '2026-11-16', end_date: '2026-11-19', est_attendance: 16500 })
  expect(r.every((c) => c.source.type === 'html')).toBe(true)
})
test('years roll over: a January date seen in November belongs to next year; a cross-month range ends in the next month', () => {
  const card = (m: string, d: string) => `<article class="item convention-item"><div class="mini-date-container"><div class="month">${m}</div><div class="day">${d}</div></div><h4 class="title">X Expo</h4></article>`
  const r = parseSimpleviewItems([card('JAN', '6-9'), card('DEC', '30 - 2'), card('NOV', '15')], src, today, {})
  expect(r.map((c) => [c.start_date, c.end_date])).toEqual([['2027-01-06', '2027-01-09'], ['2026-12-30', '2027-01-02'], ['2026-11-15', '2026-11-15']])
})
test('cards without a title or a parsable date are skipped', () => {
  const r = parseSimpleviewItems(['<article class="item convention-item"><h4 class="title">No Date</h4></article>', '<article class="item convention-item"><div class="month">FEB</div><div class="day">3</div></article>'], src, today, {})
  expect(r).toEqual([])
})

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
describe.skipIf(!existsSync(CHROME))('collectPaged (real Chrome)', () => {
  let server: Server; let base = ''
  beforeAll(async () => {
    server = createServer((_q, res) => {
      res.setHeader('content-type', 'text/html')
      res.end(`<html><body><div id="list"></div><ul class="pager"><li class="info" id="info"></li><li><a class="nxt" id="nxt">next</a></li></ul>
        <script>
          const pages = [['a1','a2'],['b1','b2'],['c1']]; let i = 0;
          function draw(){ list.innerHTML = pages[i].map(id => '<article class="convention-item" data-recid="'+id+'"><h4 class="title">'+id+'</h4></article>').join(''); info.textContent = (i*2+1)+' - '+(i*2+pages[i].length)+' of 5'; nxt.style.display = i===pages.length-1 ? 'none':'inline'; }
          nxt.onclick = () => { setTimeout(()=>{ i++; draw() }, 120) }; draw();
        </script></body></html>`)
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
  })
  afterAll(() => { server.close() })
  test('clicks through every page and returns each item once, in order', async () => {
    const b = createBrowserFetcher({ userAgent: 'T', executablePath: CHROME, canFetch: async () => true, allowLoopback: true, minIntervalMs: 0, timeoutMs: 8000 })
    const r = await b.withPage(base, (page) => collectPaged(page, { itemSelector: 'article.convention-item', nextSelector: '#nxt', idAttr: 'data-recid', maxPages: 10, settleMs: 300 }))
    await b.close()
    expect(r?.map((h) => /data-recid="(\w+)"/.exec(h)![1])).toEqual(['a1', 'a2', 'b1', 'b2', 'c1'])
  })
  test('stops at maxPages', async () => {
    const b = createBrowserFetcher({ userAgent: 'T', executablePath: CHROME, canFetch: async () => true, allowLoopback: true, minIntervalMs: 0, timeoutMs: 8000 })
    const r = await b.withPage(base, (page) => collectPaged(page, { itemSelector: 'article.convention-item', nextSelector: '#nxt', idAttr: 'data-recid', maxPages: 2, settleMs: 300 }))
    await b.close()
    expect(r).toHaveLength(4)
  })
})
