import { readFileSync } from 'node:fs'
import * as cheerio from 'cheerio'
import { parse } from 'yaml'
import { z } from 'zod'
import { extractWithLlm, type LlmBudget, type LlmClient } from '../extract/llm'
import { parseIcs } from '../extract/ical'
import { parseEventItems } from '../extract/eventitems'
import type { BrowserFetcher } from '../net/browser'
import { fetchDataTable, parseDataTableRows } from './datatable'
import { fetchExpoAssist } from './expoassist'
import { fetchMoscone } from './moscone'
import { fetchSimpleviewCalendar, parseSimpleviewItems } from './simpleview'
import { parseJsonLd } from '../extract/jsonld'
import { normalizeState } from '../normalize'
import { htmlToText } from '../text'
import type { Candidate, SourceHealth, SourceRef } from '../types'

const Entry = z.object({
  id: z.string().min(1),
  kind: z.enum(['ical', 'page', 'simpleview', 'datatable', 'expoassist', 'moscone']),
  url: z.string().url(),
  type: z.enum(['confs.tech', 'ical', 'jsonld', 'html', 'llm', 'claude-venue-calendar', 'claude-directory', 'claude-aggregator', 'api', 'aggregator', 'seed', 'submission']),
  venue: z.string().optional(), city: z.string().optional(), state: z.string().optional(),
  pages: z.array(z.string().url()).optional(),
  exclude: z.array(z.string()).optional(),
  /** simpleview only: last date to list (YYYY-MM-DD), set through the page's date picker. */
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  max_pages: z.number().int().positive().optional(),
})
export type RegistryEntry = z.infer<typeof Entry>

export function loadRegistry(path: string): RegistryEntry[] {
  let doc: unknown
  try { doc = parse(readFileSync(path, 'utf8')) } catch (e) { throw new Error(`Invalid registry ${path}: ${(e as Error).message}`) }
  const r = z.object({ sources: z.array(Entry) }).safeParse(doc)
  if (!r.success) throw new Error(`Invalid registry ${path}: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  return r.data.sources
}

export interface RunDeps {
  fetchText: (url: string) => Promise<string | null>; llm: LlmClient; budget: LlmBudget; now: () => Date
  /** Needed for `simpleview` entries (JavaScript calendars). */
  browser?: Pick<BrowserFetcher, 'withPage'>
  simpleview?: typeof fetchSimpleviewCalendar
  datatable?: typeof fetchDataTable
  moscone?: typeof fetchMoscone
}

function icalLink(html: string, base: string): string | null {
  const $ = cheerio.load(html)
  const href = $('link[rel="alternate"][type="text/calendar"]').attr('href') ?? $('a[href*="ical=1"], a[href$=".ics"]').first().attr('href')
  if (!href) return null
  try { return new URL(href, base).toString() } catch { return null }
}

export async function runEntry(entry: RegistryEntry, deps: RunDeps): Promise<{ candidates: Candidate[]; health: SourceHealth }> {
  const defaults = { venue: entry.venue, city: entry.city, state: entry.state }
  const ref = (url: string, type: SourceRef['type']): SourceRef => ({ url, type, fetched_at: deps.now().toISOString() })
  let candidates: Candidate[] = []
  let fetchedAny = false
  if (entry.kind === 'moscone') {
    if (!deps.browser) return { candidates: [], health: { id: entry.id, ok: false, count: 0, error: 'browser unavailable' } }
    const r = await (deps.moscone ?? fetchMoscone)(deps.browser, deps.fetchText, entry.url, defaults, deps.now)
    return { candidates: r.candidates, health: { ...r.health, id: entry.id } }
  }
  if (entry.kind === 'expoassist') {
    const r = await fetchExpoAssist(deps.fetchText, entry.url, entry.max_pages ?? 20)
    return { candidates: r.candidates.map((c) => ({ ...c, source: { ...c.source, fetched_at: deps.now().toISOString() } })), health: { ...r.health, id: entry.id } }
  }
  if (entry.kind === 'datatable') {
    if (!deps.browser) return { candidates: [], health: { id: entry.id, ok: false, count: 0, error: 'browser unavailable' } }
    const r = await (deps.datatable ?? fetchDataTable)(deps.browser, entry.url, { maxPages: entry.max_pages })
    if (!r) return { candidates: [], health: { id: entry.id, ok: false, count: 0, error: 'fetch failed' } }
    const found = parseDataTableRows(r.rows, ref(entry.url, 'html'), defaults)
    if (found.length === 0) return { candidates: [], health: { id: entry.id, ok: false, count: 0, error: 'no events found' } }
    const partial = r.total !== null && r.rows.length < r.total ? `partial: ${r.rows.length} of ${r.total}` : undefined
    return { candidates: found, health: { id: entry.id, ok: true, count: found.length, ...(partial ? { error: partial } : {}) } }
  }
  if (entry.kind === 'simpleview') {
    if (!deps.browser) return { candidates: [], health: { id: entry.id, ok: false, count: 0, error: 'browser unavailable' } }
    const [y, m, d] = (entry.end_date ?? '2027-12-31').split('-').map(Number)
    const r = await (deps.simpleview ?? fetchSimpleviewCalendar)(deps.browser as BrowserFetcher, entry.url, { year: y, month: m, day: d }, { maxPages: entry.max_pages })
    if (!r) return { candidates: [], health: { id: entry.id, ok: false, count: 0, error: 'fetch failed' } }
    const found = parseSimpleviewItems(r.items, ref(entry.url, 'html'), deps.now(), defaults)
    const partial = r.total !== null && r.items.length < r.total ? `partial: ${r.items.length} of ${r.total}` : undefined
    if (found.length === 0) return { candidates: [], health: { id: entry.id, ok: false, count: 0, error: 'no events found' } }
    return { candidates: found, health: { id: entry.id, ok: true, count: found.length, ...(partial ? { error: partial } : {}) } }
  }
  for (const url of [entry.url, ...(entry.pages ?? [])]) {
    const text = await deps.fetchText(url)
    if (text === null) continue
    fetchedAny = true
    let found: Candidate[]
    if (entry.kind === 'ical') {
      found = parseIcs(text, ref(url, 'ical'), defaults)
    } else {
      found = parseJsonLd(text, ref(url, 'jsonld'))
      if (found.length === 0) {
        const link = icalLink(text, url)
        const feed = link ? await deps.fetchText(link) : null
        if (link && feed !== null) found = parseIcs(feed, ref(link, 'ical'), defaults)
      }
      if (found.length === 0) found = parseEventItems(text, ref(url, 'html'), defaults, entry.exclude)
      if (found.length === 0) found = await extractWithLlm(deps.llm, deps.budget, { url, text: htmlToText(text) }, ref(url, 'llm'), defaults, deps.now())
    }
    candidates.push(...found)
  }
  candidates = candidates.map((c) => {
    const out: Candidate = { ...c, venue: c.venue ?? entry.venue, city: c.city ?? entry.city }
    const st = c.state ?? (entry.state ? normalizeState(entry.state) ?? undefined : undefined)
    if (st) out.state = st
    if (entry.type === 'aggregator') { delete out.official_url; out.source = { ...out.source, type: 'aggregator' } }
    return out
  })
  if (!fetchedAny) return { candidates: [], health: { id: entry.id, ok: false, count: 0, error: 'fetch failed' } }
  if (candidates.length === 0) return { candidates: [], health: { id: entry.id, ok: false, count: 0, error: 'no events found' } }
  return { candidates, health: { id: entry.id, ok: true, count: candidates.length } }
}
