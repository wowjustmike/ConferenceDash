import { existsSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createBrowserFetcher } from '../../src/net/browser'
import { fetchCards, parseCards } from '../../src/sources/cards'

const fx = (f: string) => readFileSync(new URL(`../fixtures/${f}`, import.meta.url), 'utf8')
const src = { url: 'https://x.example/events/', type: 'html' as const, fetched_at: '2026-11-16T00:00:00Z' }
const cfg = { item: '.ev-card', title: '.ev-card__title', date: '.ev-card__when', link: 'a' }

test('parses <time datetime> start/end and resolves relative links', () => {
  const r = parseCards(fx('cards-time.html'), cfg, src, { city: 'Denver', state: 'CO' })
  expect(r.candidates).toHaveLength(4)
  expect(r.missingYear).toBe(0)
  expect(r.seen).toBe(4)
  expect(r.candidates[0]).toMatchObject({ name: 'Name 1', start_date: '2027-03-01', end_date: '2027-03-02', city: 'Denver', state: 'Colorado', official_url: 'https://x.example/e/1' })
})
test('parses text date ranges', () => {
  const r = parseCards(fx('cards-text.html'), { item: '.listing', title: '.listing-title', date: '.listing-date' }, src)
  expect(r.candidates.map((c) => [c.start_date, c.end_date])).toEqual([['2027-03-03', '2027-03-05'], ['2027-04-10', '2027-04-10'], ['2027-12-30', '2028-01-02']])
  expect(r.candidates[2].official_url).toBe('https://collectors.example/show')
})
test('a card without a year yields no candidate and is counted', () => {
  const html = '<div class="c"><span class="t">X</span><span class="d">Nov 20 - 29</span><a href="/x">x</a></div>'.repeat(3)
  expect(parseCards(html, { item: '.c', title: '.t', date: '.d' }, src)).toMatchObject({ candidates: [], missingYear: 3, seen: 3 })
})
test('protocol-relative hrefs resolve; javascript:/mailto: links are dropped', () => {
  const html = '<div class="c"><span class="t">A</span><span class="d">Jan 5, 2027</span><a href="//cdn.example/a">a</a></div><div class="c"><span class="t">B</span><span class="d">Jan 6, 2027</span><a href="javascript:void(0)">b</a></div>'
  const r = parseCards(html, { item: '.c', title: '.t', date: '.d' }, src)
  expect(r.candidates[0].official_url).toBe('https://cdn.example/a')
  expect(r.candidates[1].official_url).toBeUndefined()
})
test('exclude patterns drop cards by name', () => {
  expect(parseCards(fx('cards-time.html'), cfg, src, {}, ['Name 2']).candidates).toHaveLength(3)
})

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
describe.skipIf(!existsSync(CHROME))('fetchCards (real Chrome)', () => {
  let server: Server; let base = ''
  beforeAll(async () => {
    server = createServer((_q, res) => {
      res.setHeader('content-type', 'text/html')
      res.end(`<html><body><div id="list"></div><a id="nxt">next</a>
        <script>
          const pages = [['a1','a2','a3'],['a1','b2','b3'],['c1','c2']]; let i = 0;
          function draw(){ list.innerHTML = pages[i].map(id => '<div class="ev"><span class="t">'+id+'</span><span class="d">Mar 3, 2027</span><a href="/e/'+id+'">x</a></div>').join(''); nxt.style.display = i===pages.length-1 ? 'none':'inline'; }
          nxt.onclick = () => { setTimeout(()=>{ i++; draw() }, 120) }; draw();
        </script></body></html>`)
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
  })
  afterAll(() => { server.close() })
  test('pages with next and dedupes items by their link', { timeout: 30000 }, async () => {
    const b = createBrowserFetcher({ userAgent: 'T', executablePath: CHROME, canFetch: async () => true, allowLoopback: true, minIntervalMs: 0, timeoutMs: 20000 })
    const r = await fetchCards(b, base, { item: '.ev', next: '#nxt', maxPages: 10 })
    await b.close()
    const parsed = parseCards(r!.html, { item: '.ev', title: '.t', date: '.d' }, { ...src, url: base })
    expect(parsed.candidates.map((c) => c.name)).toEqual(['a1', 'a2', 'a3', 'b2', 'b3', 'c1', 'c2'])
  })
  test('without next it renders once (scrolls) and returns the page', { timeout: 30000 }, async () => {
    const b = createBrowserFetcher({ userAgent: 'T', executablePath: CHROME, canFetch: async () => true, allowLoopback: true, minIntervalMs: 0, timeoutMs: 20000 })
    const r = await fetchCards(b, base, { item: '.ev', scrolls: 1 })
    await b.close()
    expect(parseCards(r!.html, { item: '.ev', title: '.t', date: '.d' }, { ...src, url: base }).candidates).toHaveLength(3)
  })
})
