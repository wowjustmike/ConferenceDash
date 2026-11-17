import * as cheerio from 'cheerio'
import { parseEventItems } from './extract/eventitems'
import { parseIcs } from './extract/ical'
import { parseJsonLd } from './extract/jsonld'
import type { BrowserFetcher } from './net/browser'
import { parseCards } from './sources/cards'
import { parseDataTableRows } from './sources/datatable'
import { detectCalendar, type Detection } from './sources/detect'
import { parseSimpleviewItems, parseSimpleviewListItems } from './sources/simpleview'
import type { Candidate, SourceRef } from './types'

export type Verdict = 'ok' | 'blocked: robots.txt' | 'blocked: bot protection' | 'unreachable' | 'needs reader' | 'nothing found'
export interface ProbeDeps {
  canFetch(url: string): Promise<boolean>
  fetchText(url: string): Promise<string | null>
  /** Status of the last fetchText call (null when it threw, timed out or was refused). */
  lastStatus(): number | null
  browser?: Pick<BrowserFetcher, 'render' | 'withPage'>
  now(): Date
}
export interface ProbeMeta { city?: string; state?: string; venue?: string; id?: string }
export interface ProbeSample { name: string; start_date?: string; end_date?: string; official_url?: string }
export interface ProbeResult {
  url: string; host: string; verdict: Verdict; detection: Detection | null; usedBrowser: boolean
  count: number; sample: ProbeSample[]; rejected: number; entry: Record<string, unknown> | null; note?: string
}

const BLOCKED_STATUS = new Set([401, 403, 429, 503])
const PLATFORM = new Set<Detection['kind']>(['loadmore', 'simpleview', 'simpleview-range', 'datatable'])

/** Registry id from a host: `www.denverconvention.com` -> `denverconvention`, `events.visitphoenix.org` -> `events-visitphoenix`. */
export function entryId(url: string): string {
  const labels = new URL(url).hostname.toLowerCase().replace(/^www\./, '').split('.')
  return (labels.length > 1 ? labels.slice(0, -1) : labels).join('-').replace(/[^a-z0-9-]/g, '')
}

/** One registry list item, indented to sit under `sources:`. */
export function entryYaml(entry: Record<string, unknown>): string {
  const q = (v: unknown) => {
    if (typeof v !== 'string') return String(v)
    return /^[A-Za-z0-9][A-Za-z0-9 _\/:?=&%,.()+-]*$/.test(v) && !/: |#|^(true|false|null|yes|no)$/i.test(v) ? v : `'${v.replace(/'/g, "''")}'`
  }
  const lines = Object.entries(entry).filter(([, v]) => v !== undefined).map(([k, v], i) => `${i === 0 ? '  - ' : '    '}${k}: ${Array.isArray(v) ? `[${v.map(q).join(', ')}]` : q(v)}`)
  return lines.join('\n') + '\n'
}

const outer = ($: cheerio.CheerioAPI, sel: string) => $(sel).toArray().map((el) => $.html(el))

/** Runs the family's parser on the HTML already in hand (only `ical` fetches again: its feed). */
async function dryRun(d: Detection, html: string, url: string, deps: ProbeDeps, defaults: { city?: string; state?: string; venue?: string }): Promise<{ candidates: Candidate[]; missingYear: number; inferYear?: boolean }> {
  const src: SourceRef = { url, type: 'html', fetched_at: deps.now().toISOString() }
  const $ = cheerio.load(html)
  switch (d.kind) {
    case 'page': { const j = parseJsonLd(html, src); return { candidates: j.length ? j : parseEventItems(html, src, defaults), missingYear: 0 } }
    case 'loadmore': return { candidates: parseEventItems(html, src, defaults), missingYear: 0 }
    case 'ical': { const feed = d.icalUrl ? await deps.fetchText(d.icalUrl) : null; return { candidates: feed ? parseIcs(feed, { ...src, type: 'ical', url: d.icalUrl! }, defaults) : [], missingYear: 0 } }
    case 'simpleview': return { candidates: parseSimpleviewItems(outer($, 'article.convention-item'), src, deps.now(), defaults), missingYear: 0 }
    case 'simpleview-range': return { candidates: parseSimpleviewListItems(outer($, '.item.isEvent'), src, deps.now(), defaults), missingYear: 0 }
    case 'datatable': return { candidates: parseDataTableRows(outer($, 'table.dataTable tbody tr'), src, defaults), missingYear: 0 }
    case 'cards': {
      const p = parseCards(html, d.cards!, src, defaults, [], deps.now())
      if (p.candidates.length > 0 || p.missingYear === 0) return { candidates: p.candidates, missingYear: p.missingYear }
      // Every card lacks a year: try the Simpleview year rule; the entry records it so the reader does the same.
      const inferred = parseCards(html, { ...d.cards!, infer_year: true }, src, defaults, [], deps.now())
      return inferred.candidates.length > 0 ? { candidates: inferred.candidates, missingYear: 0, inferYear: true } : { candidates: [], missingYear: p.missingYear }
    }
    default: return { candidates: [], missingYear: 0 }
  }
}

export async function probeUrl(url: string, deps: ProbeDeps, meta: ProbeMeta = {}): Promise<ProbeResult> {
  const host = new URL(url).hostname
  const base: ProbeResult = { url, host, verdict: 'nothing found', detection: null, usedBrowser: false, count: 0, sample: [], rejected: 0, entry: null }
  if (!(await deps.canFetch(url))) return { ...base, verdict: 'blocked: robots.txt' }
  let html = await deps.fetchText(url)
  if (html === null) {
    const status = deps.lastStatus()
    return { ...base, verdict: status !== null && BLOCKED_STATUS.has(status) ? 'blocked: bot protection' : 'unreachable', note: status !== null ? `HTTP ${status}` : undefined }
  }
  const found = detectCalendar(html, url)
  let best = found[0]
  let usedBrowser = false
  // Static HTML is only trusted when it already shows a platform list with items. Everything else is rendered: JSON-LD on a
  // calendar page is often just the featured subset, and script-filled lists have no items until they run.
  const platformWithItems = PLATFORM.has(best.kind) && best.count > 0
  if (deps.browser && !platformWithItems) {
    const r = await deps.browser.render(url, { scrolls: 3 })
    if (r) {
      usedBrowser = true
      html = r.html
      const rendered = detectCalendar(html, url)[0]
      if (rendered.kind !== 'none' && (PLATFORM.has(rendered.kind) || rendered.count >= best.count)) best = rendered
    }
  }
  if (best.kind === 'none') return { ...base, usedBrowser, detection: best }
  const defaults = { city: meta.city, state: meta.state, venue: meta.venue }
  const { candidates, missingYear, inferYear } = await dryRun(best, html, url, deps, defaults)
  const today = deps.now().toISOString().slice(0, 10)
  const horizon = `${deps.now().getUTCFullYear() + 2}${today.slice(4)}`
  const live = candidates.filter((c) => c.start_date && c.start_date <= horizon && (c.end_date ?? c.start_date) >= today)
  const sample = live.slice(0, 5).map((c) => ({ name: c.name, start_date: c.start_date, end_date: c.end_date, official_url: c.official_url }))
  const out: ProbeResult = { ...base, detection: best, usedBrowser, count: live.length, rejected: candidates.length - live.length, sample }
  if (best.kind === 'cards' && missingYear > 0 && live.length === 0) return { ...out, verdict: 'needs reader', note: `${missingYear} cards without a year` }
  if (live.length === 0) return { ...out, verdict: 'nothing found', note: candidates.length ? `${candidates.length} parsed, none upcoming` : undefined }
  const entry: Record<string, unknown> = { id: meta.id ?? entryId(url), kind: best.kind, type: best.kind === 'ical' ? 'ical' : 'html', url: best.kind === 'ical' ? best.icalUrl : url }
  if (meta.venue) entry.venue = meta.venue
  if (meta.city) entry.city = meta.city
  if (meta.state) entry.state = meta.state
  if (best.kind === 'cards') { Object.assign(entry, best.cards); if (usedBrowser) entry.render = true; if (inferYear) entry.infer_year = true }
  if (best.kind === 'simpleview' || best.kind === 'simpleview-range') entry.end_date = '2027-12-31'
  return { ...out, verdict: 'ok', entry }
}
