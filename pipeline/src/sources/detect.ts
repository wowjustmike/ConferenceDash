import * as cheerio from 'cheerio'
import type { Element } from 'domhandler'
import { parseEventItems, parseDateRangeText } from '../extract/eventitems'
import { parseJsonLd } from '../extract/jsonld'
import type { SourceRef } from '../types'

export type DetectedKind = 'page' | 'ical' | 'loadmore' | 'simpleview' | 'simpleview-range' | 'datatable' | 'cards' | 'none'
export interface CardsConfig { item: string; title: string; date: string; link?: string }
export interface Detection { kind: DetectedKind; count: number; evidence: string; needsBrowser: boolean; cards?: CardsConfig; icalUrl?: string }

/** Families in priority order; ties on count resolve in this order. */
const ORDER: DetectedKind[] = ['page', 'ical', 'loadmore', 'simpleview', 'simpleview-range', 'datatable', 'cards', 'none']
/** Platform readers paginate the whole calendar, so a platform with items outranks a JSON-LD or card list (often only the first page). */
const PLATFORM = new Set<DetectedKind>(['loadmore', 'simpleview', 'simpleview-range', 'datatable'])
const rank = (d: Detection) => (PLATFORM.has(d.kind) && d.count > 0 ? 1 : 0)

export function icalLink(html: string, base: string): string | null {
  const $ = cheerio.load(html)
  const href = $('link[rel="alternate"][type="text/calendar"]').attr('href') ?? $('a[href*="ical=1"], a[href$=".ics"]').first().attr('href')
  if (!href) return null
  try { return new URL(href, base).toString() } catch { return null }
}

const MONTH_DAY = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i
const SAFE_CLASS = /^[A-Za-z_][\w-]*$/
const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

/** `.a.b` from an element's class attribute, or null when it has no CSS-safe class. */
function classSelector(el: Element): string | null {
  const classes = (el.attribs.class ?? '').split(/\s+/).filter((c) => SAFE_CLASS.test(c)).sort()
  return classes.length ? '.' + classes.join('.') : null
}

interface Member { date: string | null; yearless: boolean; title: string | null; link: boolean }

function inspect($: cheerio.CheerioAPI, item: Element): Member {
  const node = $(item)
  let date: string | null = null
  let yearless = false
  const time = node.find('time[datetime]').first()
  if (time.length) {
    // The dated block is the nearest classed ancestor of the <time>, inside the card.
    const holder = time.parents().toArray().find((p) => p !== item && classSelector(p as Element)) as Element | undefined
    date = holder ? classSelector(holder) : null
  } else {
    // Deepest classed element whose own text is a date (or a month-day range without a year).
    const candidates = node.find('*').toArray().filter((e): e is Element => e.type === 'tag')
    for (const e of candidates.reverse()) {
      const sel = classSelector(e)
      if (!sel) continue
      const text = clean($(e).text())
      if (parseDateRangeText(text)) { date = sel; break }
      if (MONTH_DAY.test(text) && !/\d{4}/.test(text) && text.length <= 40) { date = sel; yearless = true; break }
    }
  }
  let title: string | null = null
  const heading = node.find('h1, h2, h3, h4').first()
  if (heading.length) title = classSelector(heading[0] as Element) ?? (heading[0] as Element).tagName
  else {
    const named = node.find('[class]').toArray().find((e) => /title|name|heading/i.test((e as Element).attribs.class ?? '')) as Element | undefined
    title = named ? classSelector(named) : node.find('a[href]').length ? 'a' : null
  }
  return { date, yearless, title, link: node.find('a[href]').length > 0 }
}

/** Finds the repeated block that looks most like an events list and the class selectors that read it. */
export function deriveCards(html: string): { config: CardsConfig; count: number; missingYear: number } | null {
  const $ = cheerio.load(html)
  const groups = new Map<string, Element[]>()
  $('[class]').each((_, el) => {
    const sel = classSelector(el as Element)
    if (!sel) return
    const key = `${(el as Element).tagName}${sel}`
    groups.set(key, [...(groups.get(key) ?? []), el as Element])
  })
  let best: { config: CardsConfig; count: number; missingYear: number; size: number } | null = null
  for (const [, members] of groups) {
    if (members.length < 3) continue
    const seen = members.map((m) => inspect($, m))
    const good = seen.filter((m) => m.date && m.title && m.link)
    if (good.length < 3) continue
    const pick = (f: (m: Member) => string | null) => { const c = new Map<string, number>(); for (const m of good) { const v = f(m)!; c.set(v, (c.get(v) ?? 0) + 1) } return [...c.entries()].sort((a, b) => b[1] - a[1])[0][0] }
    const config: CardsConfig = { item: classSelector(members[0])!, title: pick((m) => m.title), date: pick((m) => m.date), link: 'a' }
    const cand = { config, count: good.length, missingYear: good.filter((m) => m.yearless).length, size: members.length }
    if (!best || cand.count > best.count || (cand.count === best.count && cand.size < best.size)) best = cand
  }
  return best ? { config: best.config, count: best.count, missingYear: best.missingYear } : null
}

export function detectCalendar(html: string, url: string): Detection[] {
  const $ = cheerio.load(html)
  const stub: SourceRef = { url, type: 'html', fetched_at: '' }
  const out: Detection[] = []
  const jsonld = parseJsonLd(html, stub).length
  if (jsonld > 0) out.push({ kind: 'page', count: jsonld, evidence: `${jsonld} schema.org Event entries`, needsBrowser: false })
  const ical = icalLink(html, url)
  if (ical) out.push({ kind: 'ical', count: 0, evidence: `iCal link ${ical}`, needsBrowser: false, icalUrl: ical })
  const items = $('.eventItem').length
  if (items > 0 || /load more/i.test($('body').text())) {
    const n = items > 0 ? parseEventItems(html, stub).length : 0
    const more = /load more/i.test($('body').text())
    if (items > 0) out.push({ kind: more ? 'loadmore' : 'page', count: n, evidence: `${n} .eventItem cards`, needsBrowser: more || n === 0 })
  }
  const sv = $('article.convention-item').length
  if (sv > 0 || $('.filter.date_end').length > 0) out.push({ kind: 'simpleview', count: sv, evidence: `${sv} article.convention-item`, needsBrowser: true })
  const svr = $('.item.isEvent').length
  if (svr > 0 || $('td[data-date]').length > 0) out.push({ kind: 'simpleview-range', count: svr, evidence: `${svr} .item.isEvent`, needsBrowser: true })
  if ($('table.dataTable, .dataTables_wrapper').length > 0) {
    const rows = $('table.dataTable tbody tr').length
    out.push({ kind: 'datatable', count: rows, evidence: `${rows} table rows`, needsBrowser: true })
  }
  const cards = deriveCards(html)
  if (cards) out.push({ kind: 'cards', count: cards.count, evidence: `${cards.count} repeated ${cards.config.item} cards`, needsBrowser: false, cards: cards.config })
  if (out.length === 0) return [{ kind: 'none', count: 0, evidence: 'no calendar markup found', needsBrowser: true }]
  return out.sort((a, b) => rank(b) - rank(a) || b.count - a.count || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
}

