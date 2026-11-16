import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { join } from 'node:path'
import robotsParser from 'robots-parser'

export interface FetcherOptions {
  userAgent: string
  minIntervalMs?: number
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  fetchImpl?: typeof fetch
  cacheDir?: string
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  /** Resolves a hostname to its IP addresses (injectable for tests). */
  resolveHost?: (host: string) => Promise<string[]>
}

interface CacheEntry { etag?: string; lastModified?: string; body: string }
type Robots = ReturnType<typeof robotsParser>

const REDIRECTS = new Set([301, 302, 303, 307, 308])

/** True for loopback, private, link-local, unspecified and unique-local addresses (IPv4 and IPv6). */
export function isPrivateIp(ip: string): boolean {
  const v = ip.replace(/^\[|\]$/g, '').toLowerCase()
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v)
  if (mapped) return isPrivateIp(mapped[1])
  if (isIP(v) === 4) {
    const [a, b] = v.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  }
  if (isIP(v) === 6) return v === '::' || v === '::1' || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('fc') || v.startsWith('fd')
  return false
}

export function createFetcher(opts: FetcherOptions): { fetchText(url: string): Promise<string | null>; canFetch(url: string): Promise<boolean> } {
  const interval = opts.minIntervalMs ?? 1000
  const timeout = opts.timeoutMs ?? 15000
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024
  const maxRedirects = opts.maxRedirects ?? 3
  const doFetch = opts.fetchImpl ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = opts.now ?? (() => Date.now())
  const resolveHost = opts.resolveHost ?? (async (h: string) => (await lookup(h, { all: true })).map((a) => a.address))
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

  /** Refuses non-http(s) URLs and any host that is, or resolves to, a non-public address. */
  async function safeTarget(url: string): Promise<URL | null> {
    let u: URL
    try { u = new URL(url) } catch { return null }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase()
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return null
    if (isIP(host)) return isPrivateIp(host) ? null : u
    try {
      const addrs = await resolveHost(host)
      if (addrs.length === 0 || addrs.some(isPrivateIp)) return null
    } catch { return null }
    return u
  }

  async function throttle(host: string) {
    const wait = (lastAt.get(host) ?? -Infinity) + interval - now()
    if (wait > 0) await sleep(wait)
    lastAt.set(host, now())
  }

  async function request(url: string, headers: Record<string, string>): Promise<Response | null> {
    await throttle(new URL(url).host)
    try {
      return await doFetch(url, { headers: { 'user-agent': opts.userAgent, ...headers }, signal: AbortSignal.timeout(timeout), redirect: 'manual' })
    } catch {
      return null
    }
  }

  async function allowed(url: string): Promise<boolean> {
    const origin = new URL(url).origin
    if (!robots.has(origin)) {
      const r = await request(`${origin}/robots.txt`, {})
      robots.set(origin, r && r.ok ? robotsParser(`${origin}/robots.txt`, await readLimited(r, maxBytes).then((t) => t ?? '').catch(() => '')) : null)
    }
    const rp = robots.get(origin)
    return rp ? rp.isAllowed(url, opts.userAgent) !== false : true
  }

  return {
    /** True when the URL is public http(s) and robots.txt allows our bot (used by the browser fetcher). */
    async canFetch(url: string): Promise<boolean> {
      try { return (await safeTarget(url)) !== null && (await allowed(url)) } catch { return false }
    },
    async fetchText(url: string): Promise<string | null> {
      try {
        const original = url
        let current = url
        for (let hop = 0; hop <= maxRedirects; hop++) {
          const u = await safeTarget(current)
          if (!u) return null
          if (!(await allowed(current))) return null
          const cached = hop === 0 ? readCache(original) : undefined
          const headers: Record<string, string> = {}
          if (cached?.etag) headers['if-none-match'] = cached.etag
          if (cached?.lastModified) headers['if-modified-since'] = cached.lastModified
          let r = await request(current, headers)
          if (r && (r.status === 429 || r.status === 503)) {
            const ra = Number(r.headers.get('retry-after'))
            await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 30) * 1000 : 2000)
            r = await request(current, headers)
          }
          if (!r) return null
          if (REDIRECTS.has(r.status)) {
            const loc = r.headers.get('location')
            if (!loc) return null
            try { current = new URL(loc, current).toString() } catch { return null }
            continue
          }
          if (r.status === 304) return cached?.body ?? null
          if (!r.ok) return null
          const body = await readLimited(r, maxBytes)
          if (body === null) return null
          writeCache(original, { etag: r.headers.get('etag') ?? undefined, lastModified: r.headers.get('last-modified') ?? undefined, body })
          return body
        }
        return null // too many redirects
      } catch {
        return null
      }
    },
  }
}

/** Reads a response body as text, returning null if it exceeds maxBytes. */
async function readLimited(r: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(r.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) return null
  if (!r.body) return r.text()
  const reader = r.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) { await reader.cancel().catch(() => {}); return null }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}
