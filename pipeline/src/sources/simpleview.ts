import * as cheerio from 'cheerio'
import type { Page } from 'playwright-core'
import type { BrowserFetcher } from '../net/browser'
import { normalizeDate, toCandidateClean } from '../normalize'
import type { Candidate, SourceRef } from '../types'

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const iso = (y: number, m: number, d: number) => normalizeDate(`${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)

/**
 * Parses Simpleview "convention-item" cards (Las Vegas LVCVA / vegasmeansbusiness calendars): month + day range (no year),
 * title, organizer (host link), venue, expected attendance and the organizer's website.
 */
export function parseSimpleviewItems(items: string[], source: SourceRef, today: Date, defaults: { venue?: string; city?: string; state?: string } = {}): Candidate[] {
  const out: Candidate[] = []
  for (const html of items) {
    const $ = cheerio.load(html)
    const name = $('h4.title').first().text().replace(/\s+/g, ' ').trim()
    const mon = MONTHS.indexOf($('.mini-date-container .month').first().text().trim().slice(0, 3).toUpperCase())
    const m = /(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?/.exec($('.mini-date-container .day').first().text())
    if (!name || mon < 0 || !m) continue
    const d1 = Number(m[1])
    const d2 = m[2] ? Number(m[2]) : d1
    // The card has no year: take the next occurrence that is not long past.
    let y = today.getFullYear()
    if (new Date(y, mon, d1).getTime() < today.getTime() - 45 * 864e5) y++
    const endMonth = d2 < d1 ? mon + 1 : mon
    const start = iso(y, mon, d1)
    const end = iso(endMonth > 11 ? y + 1 : y, endMonth % 12, d2)
    if (!start || !end) continue
    const site = $('a.button-default').first().attr('href') ?? $('h5.host a').first().attr('href')
    let official_url: string | undefined
    try { if (site) { const u = new URL(site, source.url); if (u.protocol === 'http:' || u.protocol === 'https:') official_url = u.toString() } } catch { /* no url */ }
    const attendees = Number($('.attendance span').last().text().replace(/[^\d]/g, ''))
    const organizer = $('h5.host').first().text().replace(/\s+/g, ' ').trim()
    const venue = $('.venues').first().text().replace(/\s+/g, ' ').trim()
    const c = toCandidateClean({
      name, start_date: start, end_date: end, ...defaults, ...(venue ? { venue } : {}), ...(organizer ? { organizer } : {}),
      ...(attendees > 0 ? { est_attendance: attendees } : {}), ...(official_url ? { official_url } : {}), source,
    })
    if (c) out.push(c)
  }
  return out
}

const LONG_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

/** Parses Simpleview list cards (`.item.isEvent`): title link, start month/day badge (no year), and an optional "until Month D, YYYY" end. */
export function parseSimpleviewListItems(items: string[], source: SourceRef, today: Date, defaults: { venue?: string; city?: string; state?: string } = {}): Candidate[] {
  const out: Candidate[] = []
  for (const html of items) {
    const $ = cheerio.load(html)
    const a = $('a.title').first()
    const name = a.text().replace(/\s+/g, ' ').trim()
    const mon = MONTHS.indexOf($('.mini-date-container .month').first().text().trim().slice(0, 3).toUpperCase())
    const day = Number($('.mini-date-container .day').first().text().trim())
    if (!name || mon < 0 || !day) continue
    let y = today.getFullYear()
    if (new Date(y, mon, day).getTime() < today.getTime() - 45 * 864e5) y++
    const start = iso(y, mon, day)
    let end = start
    const until = /until\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/i.exec($('.recurrence').first().text())
    if (until) {
      const m = LONG_MONTHS.indexOf(until[1].toLowerCase())
      if (m >= 0) end = iso(Number(until[3]), m, Number(until[2]))
    }
    if (!start || !end || end < start) continue
    let url: string | undefined
    try { const u = new URL(a.attr('href') ?? '', source.url); if (u.protocol === 'http:' || u.protocol === 'https:') url = u.toString() } catch { /* none */ }
    const c = toCandidateClean({ name, start_date: start, end_date: end, ...defaults, ...(url ? { official_url: url } : {}), source })
    if (c) out.push(c)
  }
  return out
}

/** Clicks through a paged list, returning each item's HTML once (by id attribute), in order. */
export async function collectPaged(
  page: Page, o: { itemSelector: string; nextSelector: string; idAttr: string; maxPages: number; settleMs?: number },
): Promise<string[]> {
  const seen = new Set<string>()
  const out: string[] = []
  const snapshot = () => page.locator(o.itemSelector).evaluateAll((els, attr) => els.map((e) => ({ id: e.getAttribute(attr as string) ?? '', html: e.outerHTML })), o.idAttr)
  for (let p = 0; p < o.maxPages; p++) {
    const items = await snapshot()
    for (const it of items) if (it.id && !seen.has(it.id)) { seen.add(it.id); out.push(it.html) }
    const next = page.locator(o.nextSelector).first()
    if ((await next.count()) === 0) break
    const hidden = await next.evaluate((el) => getComputedStyle(el).display === 'none' || (el as HTMLElement).hasAttribute('disabled')).catch(() => true)
    if (hidden) break
    const firstId = items[0]?.id
    await next.dispatchEvent('click')
    const changed = await page.waitForFunction(
      ([sel, attr, prev]) => { const el = document.querySelector(sel as string); return !!el && el.getAttribute(attr as string) !== prev },
      [o.itemSelector, o.idAttr, firstId ?? ''] as const, { timeout: 6000 },
    ).then(() => true).catch(() => false)
    if (!changed) break
    await page.waitForTimeout(o.settleMs ?? 400)
  }
  return out
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/**
 * Drives a Simpleview convention calendar like a visitor: sets the end date through the date picker (day, month and year views),
 * presses Search, then pages through every result.
 */
export async function fetchSimpleviewCalendar(
  browser: BrowserFetcher, url: string, end: { year: number; month: number; day: number }, o: { maxPages?: number } = {},
): Promise<{ items: string[]; total: number | null; rangeApplied: boolean } | null> {
  return browser.withPage(url, async (page) => {
    await page.waitForSelector('article.convention-item')
    const endF = page.locator('.filter.date_end')
    const wanted = `${end.month}/${end.day}/${end.year}`
    let rangeApplied = (await endF.count()) === 0
    for (let attempt = 0; attempt < 3 && !rangeApplied; attempt++) {
      await endF.locator('input').click()
      const cals = endF.locator('.vdp-datepicker__calendar')
      // The picker keeps separate (sometimes hidden) day, month and year views; dispatching clicks reaches all of them.
      await cals.nth(0).locator('.day__month_btn').dispatchEvent('click')
      await cals.nth(1).locator('.month__year_btn').dispatchEvent('click')
      await cals.nth(2).locator('.cell.year', { hasText: String(end.year) }).dispatchEvent('click')
      await cals.nth(1).locator('.cell.month', { hasText: MONTH_NAMES[end.month - 1] }).dispatchEvent('click')
      await cals.nth(0).locator('.cell.day', { hasText: new RegExp(`^${end.day}$`) }).dispatchEvent('click')
      await page.getByRole('button', { name: 'Search' }).last().click()
      await page.waitForFunction(() => /of\s+\d+/.test(document.querySelector('li.info')?.textContent ?? ''), undefined, { timeout: 10000 }).catch(() => {})
      await page.waitForTimeout(1500)
      // The picker occasionally ignores the clicks; only trust the result when the end date field shows the date we set.
      rangeApplied = (await endF.locator('input').inputValue().catch(() => '')) === wanted
    }
    const info = (await page.locator('li.info').first().textContent().catch(() => '')) ?? ''
    const total = /of\s+(\d+)/.exec(info)?.[1]
    const items = await collectPaged(page, { itemSelector: 'article.convention-item', nextSelector: '.pager a.nxt', idAttr: 'data-recid', maxPages: o.maxPages ?? 40 })
    return { items, total: total ? Number(total) : null, rangeApplied }
  })
}

/**
 * Orange County Convention Center style: sets a date range in the airbnb-style picker (start day, then the end day months later),
 * then pages through every card.
 */
export async function fetchSimpleviewRange(
  browser: BrowserFetcher, url: string, range: { start: string; end: string }, o: { maxPages?: number } = {},
): Promise<{ items: string[]; total: number | null } | null> {
  return browser.withPage(url, async (page) => {
    await page.waitForSelector('.item.isEvent')
    const cell = (d: string) => page.locator(`td[data-date="${d}"]`).first()
    await cell(range.start).click({ force: true })
    await page.waitForTimeout(400)
    for (let i = 0; i < 24 && (await cell(range.end).count()) === 0; i++) await page.locator('.asd__change-month-button--next button').first().dispatchEvent('click')
    await cell(range.end).click({ force: true })
    await page.waitForFunction(() => /of\s+\d+/.test(document.querySelector('li.info')?.textContent ?? ''), undefined, { timeout: 10000 }).catch(() => {})
    await page.waitForTimeout(2500)
    const info = (await page.locator('li.info').first().textContent().catch(() => '')) ?? ''
    const total = /of\s+(\d+)/.exec(info)?.[1]
    const items = await collectPaged(page, { itemSelector: '.item.isEvent', nextSelector: '.pager a.nxt', idAttr: 'data-recid', maxPages: o.maxPages ?? 40 })
    return { items, total: total ? Number(total) : null }
  })
}
