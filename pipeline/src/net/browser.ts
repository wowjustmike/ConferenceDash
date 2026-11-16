import { isIP } from 'node:net'
import { chromium, type Browser } from 'playwright-core'
import { isPrivateIp } from './http'

export interface BrowserOptions {
  userAgent: string
  /** Path to a Chrome/Chromium binary. Defaults to the installed Google Chrome (`channel: 'chrome'`). */
  executablePath?: string
  /** Robots.txt + public-address guard (use `createFetcher(...).canFetch`). */
  canFetch: (url: string) => Promise<boolean>
  minIntervalMs?: number
  timeoutMs?: number
  maxHtmlBytes?: number
  /** Tests only: allow subrequests to loopback addresses. */
  allowLoopback?: boolean
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

export interface RenderOptions {
  /** Wait until this text (or regex) appears in the page body. */
  waitForText?: string | RegExp
  waitForSelector?: string
  /** Scroll to the bottom this many times (lazy-loaded lists), pausing between scrolls. */
  scrolls?: number
  settleMs?: number
}
export interface Rendered { html: string; text: string; finalUrl: string }

const BLOCKED_TYPES = new Set(['image', 'media', 'font'])

export function createBrowserFetcher(opts: BrowserOptions): { render(url: string, o?: RenderOptions): Promise<Rendered | null>; close(): Promise<void> } {
  const interval = opts.minIntervalMs ?? 1000
  const timeout = opts.timeoutMs ?? 20000
  const maxHtml = opts.maxHtmlBytes ?? 8 * 1024 * 1024
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = opts.now ?? (() => Date.now())
  const lastAt = new Map<string, number>()
  let browser: Browser | null = null

  const launch = async () => (browser ??= await chromium.launch(opts.executablePath ? { executablePath: opts.executablePath, headless: true } : { channel: 'chrome', headless: true }))

  const subrequestOk = (u: string): boolean => {
    let url: URL
    try { url = new URL(u) } catch { return false }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
    if (opts.allowLoopback && (host === '127.0.0.1' || host === 'localhost')) return true
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false
    return !(isIP(host) && isPrivateIp(host))
  }

  return {
    async render(url, o = {}) {
      try {
        const u = new URL(url)
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
        if (!(await opts.canFetch(url))) return null
        const wait = (lastAt.get(u.host) ?? -Infinity) + interval - now()
        if (wait > 0) await sleep(wait)
        lastAt.set(u.host, now())
        const b = await launch()
        const ctx = await b.newContext({ userAgent: opts.userAgent, acceptDownloads: false, serviceWorkers: 'block' })
        try {
          await ctx.route('**/*', (route) => {
            const req = route.request()
            if (BLOCKED_TYPES.has(req.resourceType()) || !subrequestOk(req.url())) return route.abort()
            return route.continue()
          })
          const page = await ctx.newPage()
          page.setDefaultTimeout(timeout)
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout })
          await page.waitForLoadState('networkidle', { timeout: Math.min(timeout, 8000) }).catch(() => {})
          if (o.waitForSelector) await page.waitForSelector(o.waitForSelector, { timeout })
          if (o.waitForText !== undefined) {
            const w = o.waitForText
            await page.waitForFunction(
              ([needle, isRe]) => (isRe ? new RegExp(needle as string).test(document.body.innerText) : document.body.innerText.includes(needle as string)),
              [w instanceof RegExp ? w.source : w, w instanceof RegExp] as const, { timeout },
            )
          }
          for (let i = 0; i < (o.scrolls ?? 0); i++) {
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
            await page.waitForTimeout(o.settleMs ?? 600)
          }
          const html = await page.content()
          if (Buffer.byteLength(html) > maxHtml) return null
          const text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').trim()
          return { html, text, finalUrl: page.url() }
        } finally {
          await ctx.close().catch(() => {})
        }
      } catch {
        return null
      }
    },
    async close() { await browser?.close().catch(() => {}); browser = null },
  }
}
