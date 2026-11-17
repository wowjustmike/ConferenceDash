import * as cheerio from 'cheerio'
import type { Element } from 'domhandler'
import { parseEventItems, parseDateRangeText, parseMonthDayRange } from '../extract/eventitems'
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
    // Deepest classed element whose own text is a date (or a month-day range without a year)...
    const kindOf = (e: Element): 'dated' | 'yearless' | null => {
      const text = clean($(e).text())
      if (text.length > 60) return null
      if (parseDateRangeText(text)) return 'dated'
      if (MONTH_DAY.test(text) && !/\d{4}/.test(text) && parseMonthDayRange(text, new Date())) return 'yearless'
      return null
    }
    const candidates = node.find('*').toArray().filter((e): e is Element => e.type === 'tag')
    for (const e of candidates.reverse()) {
      const sel = classSelector(e)
      if (!sel) continue
      const text = clean($(e).text())
      let k = kindOf(e)
      if (!k && MONTH_DAY.test(text) && !/\d{4}/.test(text) && text.length <= 40) k = 'yearless'
      if (!k) continue
      // ...widened to the outermost classed ancestor inside the card that still reads as a date, so "Nov 19" | " - " | "22 / 2026"
      // spans resolve to the block holding the whole range (a dated ancestor beats a yearless one).
      let best = { sel, k, el: e }
      for (const p of $(e).parents().toArray() as Element[]) {
        if (p === item) break
        const pk = kindOf(p)
        if (!pk) break
        const ps = classSelector(p)
        if (ps && !(best.k === 'dated' && pk === 'yearless')) best = { sel: ps, k: pk, el: p }
      }
      date = best.sel; yearless = best.k === 'yearless'
      // Start and end in sibling blocks ("caldate startmo" | "caldate endmo"): read both through the class they share.
      const own = new Set(best.sel.slice(1).split('.'))
      for (const sib of $(best.el).siblings().toArray() as Element[]) {
        const ss = classSelector(sib)
        const common = ss ? ss.slice(1).split('.').filter((c) => own.has(c)) : []
        if (common.length && kindOf(sib)) { date = '.' + common.sort().join('.'); break }
      }
      break
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
  // Cards are grouped by their full class list and, when they have several classes, by each single class too, so
  // "event-item" and "event-item no-link" cards land in one group.
  const groups = new Map<string, { sel: string; members: Element[] }>()
  const add = (key: string, sel: string, el: Element) => { const g = groups.get(key) ?? { sel, members: [] }; g.members.push(el); groups.set(key, g) }
  $('[class]').each((_, el) => {
    const e = el as Element
    const sel = classSelector(e)
    if (!sel) return
    add(`${e.tagName}${sel}`, sel, e)
    const parts = sel.slice(1).split('.')
    if (parts.length > 1) for (const c of parts) add(`${e.tagName}.${c}`, '.' + c, e)
  })
  let best: { config: CardsConfig; count: number; missingYear: number; size: number } | null = null
  for (const [, { sel: itemSel, members }] of groups) {
    if (members.length < 3) continue
    // Card lists never nest: a class that marks both a card and blocks inside it would read every event twice.
    const set = new Set(members)
    if (members.some((m) => $(m).parents().toArray().some((p) => set.has(p as Element)))) continue
    const seen = members.map((m) => inspect($, m))
    const good = seen.filter((m) => m.date && m.title && m.link)
    if (good.length < 3) continue
    const pick = (f: (m: Member) => string | null) => { const c = new Map<string, number>(); for (const m of good) { const v = f(m)!; c.set(v, (c.get(v) ?? 0) + 1) } return [...c.entries()].sort((a, b) => b[1] - a[1])[0][0] }
    // Title classes can differ between cards ("long_title title" vs "title"): try every observed selector and each of its
    // single classes, and keep the one that finds a titled element in the most cards (the more specific wins a tie).
    const shared = (f: (m: Member) => string | null) => {
      const tried = new Set<string>()
      for (const m of good) { const v = f(m)!; tried.add(v); if (v.startsWith('.')) for (const c of v.slice(1).split('.')) tried.add('.' + c) }
      const cards = members.filter((_, i) => seen[i].date && seen[i].title && seen[i].link)
      const hits = (sel: string) => cards.filter((c) => clean($(c).find(sel).first().text()).length > 0).length
      return [...tried].map((sel) => ({ sel, n: hits(sel) })).sort((x, y) => y.n - x.n || y.sel.length - x.sel.length)[0].sel
    }
    const config: CardsConfig = { item: itemSel, title: shared((m) => m.title), date: pick((m) => m.date), link: 'a' }
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
  // Cards that a platform reader already covers (.eventItem, Simpleview items) stay with that reader.
  const platform = $(cards?.config.item ?? '*').filter('.eventItem, .convention-item, .isEvent').length > 0
  if (cards && !platform) out.push({ kind: 'cards', count: cards.count, evidence: `${cards.count} repeated ${cards.config.item} cards`, needsBrowser: false, cards: cards.config })
  if (out.length === 0) return [{ kind: 'none', count: 0, evidence: 'no calendar markup found', needsBrowser: true }]
  return out.sort((a, b) => rank(b) - rank(a) || b.count - a.count || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
}

