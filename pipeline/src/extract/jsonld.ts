import * as cheerio from 'cheerio'
import { normalizeState, toCandidateClean } from '../normalize'
import type { Candidate, SourceRef } from '../types'

type J = Record<string, unknown>
const isObj = (v: unknown): v is J => typeof v === 'object' && v !== null && !Array.isArray(v)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v])
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const nameOf = (v: unknown): string | undefined => str(v) ?? (isObj(v) ? str(v.name) : undefined)

function isEvent(n: J): boolean {
  return arr(n['@type']).some((t) => typeof t === 'string' && /(Event|Festival)$/.test(t))
}

function* walk(node: unknown): Generator<J> {
  if (Array.isArray(node)) { for (const n of node) yield* walk(n); return }
  if (!isObj(node)) return
  if (isEvent(node)) yield node
  for (const key of ['@graph', 'itemListElement', 'item', 'subEvent']) if (key in node) yield* walk(node[key])
}

function place(loc: unknown): { venue?: string; city?: string; state?: string } {
  const l = arr(loc).find((x) => typeof x === 'string' || isObj(x))
  if (l === undefined) return {}
  if (typeof l === 'string') return { venue: l }
  const out: { venue?: string; city?: string; state?: string } = { venue: str(l.name) }
  const a = l.address
  if (isObj(a)) {
    out.city = str(a.addressLocality)
    out.state = str(a.addressRegion)
  } else if (typeof a === 'string') {
    const parts = a.split(',').map((s) => s.trim())
    for (let i = parts.length - 1; i > 0; i--) {
      const m = /^([A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/.exec(parts[i])
      if (m && normalizeState(m[1])) { out.city = parts[i - 1]; out.state = m[1]; break }
    }
  }
  return out
}

export function parseJsonLd(html: string, source: SourceRef): Candidate[] {
  const $ = cheerio.load(html)
  const out: Candidate[] = []
  $('script[type="application/ld+json"]').each((_, el) => {
    let data: unknown
    try { data = JSON.parse($(el).text()) } catch { return }
    for (const ev of walk(data)) {
      const name = str(ev.name)
      const start = str(ev.startDate)
      if (!name || !start) continue
      const url = str(ev.url)
      const loc = place(ev.location)
      const c = toCandidateClean({
        name, start_date: start, end_date: str(ev.endDate) ?? start, ...loc,
        ...(nameOf(arr(ev.organizer)[0]) ? { organizer: nameOf(arr(ev.organizer)[0]) } : {}),
        ...(url && /^https?:\/\//i.test(url) ? { official_url: url } : {}), source,
      })
      if (c) out.push(c)
    }
  })
  return out
}
