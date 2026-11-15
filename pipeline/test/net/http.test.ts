import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFetcher } from '../../src/net/http'

const UA = 'ConferenceDashBot/1.0'
const res = (status: number, body = '', headers: Record<string, string> = {}) => new Response(status === 304 ? null : body, { status, headers })

function setup(routes: Record<string, (init?: RequestInit) => Response | Promise<Response>>, extra: Record<string, unknown> = {}) {
  const calls: string[] = []
  const sleeps: number[] = []
  let t = 1_000_000
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push(url)
    const r = routes[url]
    if (!r) return res(404)
    return r(init)
  })
  const f = createFetcher({
    userAgent: UA, minIntervalMs: 1000, fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async (ms: number) => { sleeps.push(ms); t += ms }, now: () => t, ...extra,
  })
  return { f, calls, sleeps, fetchImpl }
}

test('robots Disallow blocks the content request entirely', async () => {
  const { f, calls } = setup({ 'https://a.example/robots.txt': () => res(200, 'User-agent: *\nDisallow: /'), 'https://a.example/x': () => res(200, 'secret') })
  expect(await f.fetchText('https://a.example/x')).toBeNull()
  expect(calls).not.toContain('https://a.example/x')
})
test('missing robots.txt means allowed; sends our user agent', async () => {
  let ua = ''
  const { f } = setup({ 'https://a.example/x': (init) => { ua = new Headers(init?.headers).get('user-agent') ?? ''; return res(200, 'ok') } })
  expect(await f.fetchText('https://a.example/x')).toBe('ok')
  expect(ua).toBe(UA)
})
test('4xx/5xx and thrown errors return null, never throw', async () => {
  const { f } = setup({ 'https://a.example/403': () => res(403), 'https://a.example/500': () => res(500), 'https://a.example/boom': () => { throw new Error('net') } })
  expect(await f.fetchText('https://a.example/403')).toBeNull()
  expect(await f.fetchText('https://a.example/500')).toBeNull()
  expect(await f.fetchText('https://a.example/boom')).toBeNull()
})
test('429 then 200 retries once after Retry-After', async () => {
  let n = 0
  const { f, sleeps } = setup({ 'https://a.example/x': () => (n++ === 0 ? res(429, '', { 'retry-after': '3' }) : res(200, 'done')) })
  expect(await f.fetchText('https://a.example/x')).toBe('done')
  expect(sleeps.some((ms) => ms >= 3000)).toBe(true)
})
test('persistent 429 gives up with null after one retry', async () => {
  const { f, fetchImpl } = setup({ 'https://a.example/x': () => res(429) })
  expect(await f.fetchText('https://a.example/x')).toBeNull()
  expect(fetchImpl.mock.calls.filter((c) => String(c[0]) === 'https://a.example/x')).toHaveLength(2)
})
test('requests to one host are spaced by minIntervalMs', async () => {
  const { f, sleeps } = setup({ 'https://a.example/1': () => res(200, '1'), 'https://a.example/2': () => res(200, '2') })
  await f.fetchText('https://a.example/1')
  sleeps.length = 0
  await f.fetchText('https://a.example/2')
  expect(sleeps.some((ms) => ms > 0 && ms <= 1000)).toBe(true)
})
test('304 returns the cached body (conditional headers sent)', async () => {
  let seen: Headers | undefined
  let n = 0
  const { f } = setup({ 'https://a.example/x': (init) => { if (n++ === 0) return res(200, 'body', { etag: '"v1"' }); seen = new Headers(init?.headers); return res(304) } })
  expect(await f.fetchText('https://a.example/x')).toBe('body')
  expect(await f.fetchText('https://a.example/x')).toBe('body')
  expect(seen?.get('if-none-match')).toBe('"v1"')
})
test('disk cache survives across fetcher instances', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cdcache-'))
  const a = setup({ 'https://a.example/x': () => res(200, 'persisted', { etag: '"e"' }) }, { cacheDir: dir })
  await a.f.fetchText('https://a.example/x')
  const b = setup({ 'https://a.example/x': () => res(304) }, { cacheDir: dir })
  expect(await b.f.fetchText('https://a.example/x')).toBe('persisted')
})
test('non-http(s) urls are refused', async () => {
  const { f, fetchImpl } = setup({})
  expect(await f.fetchText('file:///etc/passwd')).toBeNull()
  expect(await f.fetchText('javascript:alert(1)')).toBeNull()
  expect(fetchImpl).not.toHaveBeenCalled()
})
