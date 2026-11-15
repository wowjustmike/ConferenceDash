import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import robotsParser from 'robots-parser'

export interface FetcherOptions {
  userAgent: string
  minIntervalMs?: number
  timeoutMs?: number
  fetchImpl?: typeof fetch
  cacheDir?: string
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

interface CacheEntry { etag?: string; lastModified?: string; body: string }
type Robots = ReturnType<typeof robotsParser>

export function createFetcher(opts: FetcherOptions): { fetchText(url: string): Promise<string | null> } {
  const interval = opts.minIntervalMs ?? 1000
  const timeout = opts.timeoutMs ?? 15000
  const doFetch = opts.fetchImpl ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = opts.now ?? (() => Date.now())
  const lastAt = new Map<string, number>()
  const robots = new Map<string, Robots | null>()
  const memCache = new Map<string, CacheEntry>()
  if (opts.cacheDir) mkdirSync(opts.cacheDir, { recursive: true })

  const cacheFile = (url: string) => join(opts.cacheDir!, `${createHash('sha1').update(url).digest('hex')}.json`)
  const readCache = (url: string): CacheEntry | undefined => {
    const m = memCache.get(url)
    if (m) return m
    if (!opts.cacheDir) return undefined
    try { return JSON.parse(readFileSync(cacheFile(url), 'utf8')) as CacheEntry } catch { return undefined }
  }
  const writeCache = (url: string, e: CacheEntry) => {
    memCache.set(url, e)
    if (opts.cacheDir) try { writeFileSync(cacheFile(url), JSON.stringify(e)) } catch { /* cache is best-effort */ }
  }

  async function throttle(host: string) {
    const wait = (lastAt.get(host) ?? -Infinity) + interval - now()
    if (wait > 0) await sleep(wait)
    lastAt.set(host, now())
  }

  async function request(url: string, headers: Record<string, string>): Promise<Response | null> {
    const host = new URL(url).host
    await throttle(host)
    try {
      return await doFetch(url, { headers: { 'user-agent': opts.userAgent, ...headers }, signal: AbortSignal.timeout(timeout), redirect: 'follow' })
    } catch {
      return null
    }
  }

  async function allowed(url: string): Promise<boolean> {
    const origin = new URL(url).origin
    if (!robots.has(origin)) {
      const r = await request(`${origin}/robots.txt`, {})
      robots.set(origin, r && r.ok ? robotsParser(`${origin}/robots.txt`, await r.text().catch(() => '')) : null)
    }
    const rp = robots.get(origin)
    return rp ? rp.isAllowed(url, opts.userAgent) !== false : true
  }

  return {
    async fetchText(url: string): Promise<string | null> {
      let u: URL
      try { u = new URL(url) } catch { return null }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
      try {
        if (!(await allowed(url))) return null
        const cached = readCache(url)
        const headers: Record<string, string> = {}
        if (cached?.etag) headers['if-none-match'] = cached.etag
        if (cached?.lastModified) headers['if-modified-since'] = cached.lastModified
        let r = await request(url, headers)
        if (r && (r.status === 429 || r.status === 503)) {
          const ra = Number(r.headers.get('retry-after'))
          await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 30) * 1000 : 2000)
          r = await request(url, headers)
        }
        if (!r) return null
        if (r.status === 304) return cached?.body ?? null
        if (!r.ok) return null
        const body = await r.text()
        writeCache(url, { etag: r.headers.get('etag') ?? undefined, lastModified: r.headers.get('last-modified') ?? undefined, body })
        return body
      } catch {
        return null
      }
    },
  }
}
