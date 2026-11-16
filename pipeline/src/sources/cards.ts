import * as cheerio from 'cheerio'
import { parseDateRangeText } from '../extract/eventitems'
import type { BrowserFetcher } from '../net/browser'
import { normalizeDate, toCandidateClean } from '../normalize'
import type { Candidate, SourceRef } from '../types'
import type { CardsConfig } from './detect'
import { collectPaged } from './paging'

export interface CardsParse { candidates: Candidate[]; missingYear: number; seen: number }

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

function httpUrl(href: string | undefined, base: string): string | undefined {
  if (!href) return undefined
  try { const u = new URL(href, base); return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : undefined } catch { return undefined }
}

/** Reads one card list from CSS selectors (derived by `deriveCards` or written in the registry). Cards without a year are counted, never guessed. */
export function parseCards(html: string, cfg: CardsConfig, source: SourceRef, defaults: { venue?: string; city?: string; state?: string } = {}, exclude: string[] = []): CardsParse {
  const $ = cheerio.load(html)
  const bad = exclude.map((p) => new RegExp(p, 'i'))
  const out: CardsParse = { candidates: [], missingYear: 0, seen: 0 }
  $(cfg.item).each((_, el) => {
    const card = $(el)
    out.seen++
    const name = clean(card.find(cfg.title).first().text())
    const dateEl = card.find(cfg.date).first()
    const times = dateEl.find('time[datetime]').toArray().map((t) => $(t).attr('datetime') ?? '')
    let range: { start: string; end: string } | null = null
    if (times.length) {
      const start = normalizeDate(times[0]); const end = normalizeDate(times[1] ?? times[0])
      if (start && end) range = { start, end }
    } else {
      const text = clean(dateEl.text())
      if (!/\b\d{4}\b/.test(text)) { if (text) out.missingYear++; return }
      range = parseDateRangeText(text)
    }
    if (!name || !range || bad.some((re) => re.test(name))) return
    const link = card.find(cfg.link ?? 'a[href]').first().attr('href')
    const official_url = httpUrl(link, source.url)
    const c = toCandidateClean({ name, start_date: range.start, end_date: range.end, ...defaults, ...(official_url ? { official_url } : {}), source })
    if (c) out.candidates.push(c)
  })
  return out
}

/** Renders a card list in the browser: scrolls for lazy lists, or pages through a `next` control collecting every card once. */
export async function fetchCards(
  browser: Pick<BrowserFetcher, 'render' | 'withPage'>, url: string, o: { scrolls?: number; next?: string; item: string; maxPages?: number },
): Promise<{ html: string } | null> {
  if (!o.next) {
    const r = await browser.render(url, { scrolls: o.scrolls ?? 0 })
    return r ? { html: r.html } : null
  }
  const next = o.next
  return browser.withPage(url, async (page) => {
    // collectPaged needs a stable id per card to notice page changes and skip repeats: tag each card by its link (or text) as it appears.
    await page.evaluate((sel) => {
      const tag = () => document.querySelectorAll(sel).forEach((el) => {
        if (!el.hasAttribute('data-cd-id')) el.setAttribute('data-cd-id', (el.querySelector('a[href]')?.getAttribute('href') ?? el.textContent ?? '').trim().slice(0, 200))
      })
      tag()
      new MutationObserver(tag).observe(document.body, { childList: true, subtree: true })
    }, o.item)
    const items = await collectPaged(page, { itemSelector: o.item, nextSelector: next, idAttr: 'data-cd-id', maxPages: o.maxPages ?? 40 })
    return { html: `<div>${items.join('')}</div>` }
  })
}
