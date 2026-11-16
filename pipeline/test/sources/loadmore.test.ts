import { existsSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createBrowserFetcher } from '../../src/net/browser'
import { fetchLoadMore } from '../../src/sources/loadmore'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
describe.skipIf(!existsSync(CHROME))('fetchLoadMore (real Chrome)', () => {
  let server: Server; let base = ''
  beforeAll(async () => {
    server = createServer((_q, res) => {
      res.setHeader('content-type', 'text/html')
      res.end(`<html><body><div id="list"></div><a id="more" href="#" class="loadMore">Load More Events</a>
        <script>let n = 0; const add = () => { for (let i = 0; i < 3 && n < 8; i++) { n++; list.insertAdjacentHTML('beforeend', '<div class="eventItem" data-n="'+n+'">E'+n+'</div>') } if (n >= 8) more.style.display = 'none' }
        more.onclick = (e) => { e.preventDefault(); setTimeout(add, 100) }; add()</script></body></html>`)
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
  })
  afterAll(() => { server.close() })
  const mk = () => createBrowserFetcher({ userAgent: 'T', executablePath: CHROME, canFetch: async () => true, allowLoopback: true, minIntervalMs: 0, timeoutMs: 20000 })

  test('clicks "Load More" until it disappears and returns all items', { timeout: 30000 }, async () => {
    const b = mk()
    const r = await fetchLoadMore(b, base, { maxClicks: 10, settleMs: 300 })
    await b.close()
    expect((r?.html.match(/<div class="eventItem" data-n="\d+">/g) ?? []).length).toBe(8)
    expect(r?.clicks).toBe(2)
  })
  test('stops at maxClicks', { timeout: 30000 }, async () => {
    const b = mk()
    const r = await fetchLoadMore(b, base, { maxClicks: 1, settleMs: 300 })
    await b.close()
    expect((r?.html.match(/<div class="eventItem" data-n="\d+">/g) ?? []).length).toBe(6)
  })
})
