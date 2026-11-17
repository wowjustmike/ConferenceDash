import * as cheerio from 'cheerio'
import { parseDateRangeText, parseMonthDayRange } from '../extract/eventitems'
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
export type CardsOptions = CardsConfig & { /** Resolve month-day dates without a year to their next occurrence (Simpleview rule). */ infer_year?: boolean }

export function parseCards(html: string, cfg: CardsOptions, source: SourceRef, defaults: { venue?: string; city?: string; state?: string } = {}, exclude: string[] = [], today: Date = new Date()): CardsParse {
  const $ = cheerio.load(html)
  const bad = exclude.map((p) => new RegExp(p, 'i'))
  const out: CardsParse = { candidates: [], missingYear: 0, seen: 0 }
  $(cfg.item).each((_, el) => {
    const card = $(el)
    out.seen++
    // "City Summit Attendance: 4,200": the count leaves the name and becomes the size.
    let name = clean(card.find(cfg.title).first().text())
    let est_attendance: number | undefined
    const att = /\s*\(?attendance:?\s*([\d,]+)\)?$/i.exec(name)
    if (att) { name = name.slice(0, att.index).trim(); const n = Number(att[1].replace(/,/g, '')); if (n > 0) est_attendance = n }
    // The date selector can also match sibling lines (location, time): the first element that reads as a date wins,
    // and a later single day right after a single-day start ends the range (separate start and end blocks).
    let range: { start: string; end: string } | null = null
    let yearless = false
    for (const d of card.find(cfg.date).toArray()) {
      const dateEl = $(d)
      let r: { start: string; end: string } | null = null
      const times = dateEl.find('time[datetime]').toArray().map((t) => $(t).attr('datetime') ?? '')
      if (times.length) {
        const start = normalizeDate(times[0]); const end = normalizeDate(times[1] ?? times[0])
        if (start && end) r = { start, end }
      } else {
        const text = clean(dateEl.text())
        if (!/\b\d{4}\b/.test(text)) {
          if (cfg.infer_year) r = parseMonthDayRange(text, today)
          if (!r && text) yearless = true
        } else r = parseDateRangeText(text)
      }
      if (!r) continue
      if (!range) { range = r; if (r.start !== r.end) break; continue }
      const days = (Date.parse(r.start) - Date.parse(range.start)) / 864e5
      if (r.start === r.end && days > 0 && days <= 60) range = { start: range.start, end: r.end }
      break
    }
    if (!range) { if (yearless) out.missingYear++; return }
    if (!name || !range || bad.some((re) => re.test(name))) return
    const link = card.find(cfg.link ?? 'a[href]').first().attr('href')
    const official_url = httpUrl(link, source.url)
    const c = toCandidateClean({ name, start_date: range.start, end_date: range.end, ...defaults, ...(est_attendance ? { est_attendance } : {}), ...(official_url ? { official_url } : {}), source })
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
