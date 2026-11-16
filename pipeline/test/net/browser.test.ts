import { existsSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createBrowserFetcher } from '../../src/net/browser'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const hasChrome = existsSync(CHROME)

let server: Server
let base = ''
const hits: string[] = []
beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push(req.url ?? '')
    if (req.url === '/slow') return // never responds
    if (req.url === '/tracker.js') { res.setHeader('content-type', 'text/javascript'); res.end('document.title="tracked"'); return }
    res.setHeader('content-type', 'text/html')
    res.end(`<html><head><title>T</title></head><body><div id="cal"></div>
      <script>setTimeout(()=>{document.getElementById('cal').innerHTML='<ul><li>CES 2027 Jan 6-9</li><li>NAB Show Apr 17-21</li></ul>'}, 150)</script>
      <img src="/pixel.png"></body></html>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => { server.close() })

const mk = (o: Record<string, unknown> = {}) =>
  createBrowserFetcher({ userAgent: 'ConferenceDashBot/1.0', executablePath: CHROME, canFetch: async () => true, allowLoopback: true, minIntervalMs: 0, timeoutMs: 4000, ...o })

describe.skipIf(!hasChrome)('browser fetcher (real Chrome)', () => {
  test('renders JavaScript-built content and returns text and html', async () => {
    const b = mk()
    const r = await b.render(`${base}/`, { waitForText: 'NAB Show' })
    await b.close()
    expect(r?.text).toContain('CES 2027 Jan 6-9')
    expect(r?.text).toContain('NAB Show Apr 17-21')
    expect(r?.html).toContain('<li>CES 2027')
  })
  test('does not request pages that the guard refuses', async () => {
    const before = hits.length
    const b = mk({ canFetch: async () => false })
    expect(await b.render(`${base}/refused`)).toBeNull()
    await b.close()
    expect(hits.slice(before)).toEqual([])
  })
  test('returns null on timeout instead of hanging or throwing', async () => {
    const b = mk({ timeoutMs: 800 })
    expect(await b.render(`${base}/slow`)).toBeNull()
    await b.close()
  })
  test('blocks images and non-http schemes; refuses non-http urls', async () => {
    const before = hits.length
    const b = mk()
    expect(await b.render('file:///etc/passwd')).toBeNull()
    await b.render(`${base}/img`)
    await b.close()
    expect(hits.slice(before).some((u) => u.includes('pixel.png'))).toBe(false)
  })
  test('spaces requests to one host by minIntervalMs', async () => {
    const sleeps: number[] = []
    let t = 1000
    const b = mk({ minIntervalMs: 1000, sleep: async (ms: number) => { sleeps.push(ms); t += ms }, now: () => t })
    await b.render(`${base}/1`)
    await b.render(`${base}/2`)
    await b.close()
    expect(sleeps.some((ms) => ms > 0)).toBe(true)
  })
})
