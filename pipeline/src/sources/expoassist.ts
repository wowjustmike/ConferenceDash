import * as cheerio from 'cheerio'
import { cityToState, normalizeDate, toCandidateClean } from '../normalize'
import type { Candidate, SourceHealth, SourceRef } from '../types'

const dmy = (s: string): string | null => {
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(s)
  return m ? normalizeDate(`${m[3]}-${m[2]}-${m[1]}`) : null
}

/** Parses ExpoAssist listing cards (title, DD.MM.YYYY - DD.MM.YYYY, city link). It is an aggregator, so no official URL is claimed. */
export function parseExpoAssist(html: string, source: SourceRef): Candidate[] {
  const $ = cheerio.load(html)
  const out: Candidate[] = []
  $('.grid-inner').each((_, el) => {
    const card = $(el)
    const name = card.find('h3').first().text().replace(/\s+/g, ' ').trim()
    const range = /(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})/.exec(card.text())
    const start = range ? dmy(range[1]) : null
    const end = range ? dmy(range[2]) : null
    const city = card.find('a[href*="/events/city/"]').first().text().trim()
    const state = city ? cityToState(city) : null
    if (!name || !start || !end || !city || !state) return
    let detail = source.url
    try { detail = new URL(card.find('a[href^="/event/"]').first().attr('href') ?? '', source.url).toString() } catch { /* keep the listing url */ }
    const c = toCandidateClean({ name, start_date: start, end_date: end, city, state, source: { ...source, url: detail } })
    if (c) out.push(c)
  })
  return out
}

/** Walks the paged US listing until a page adds nothing new. */
export async function fetchExpoAssist(
  fetchText: (url: string) => Promise<string | null>, baseUrl: string, maxPages = 20,
): Promise<{ candidates: Candidate[]; health: SourceHealth }> {
  const seen = new Set<string>()
  const candidates: Candidate[] = []
  let okPages = 0
  for (let page = 1; page <= maxPages; page++) {
    const url = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}page=${page}`
    const html = await fetchText(url)
    if (html === null) break
    okPages++
    const fresh = parseExpoAssist(html, { url: baseUrl, type: 'aggregator', fetched_at: new Date().toISOString() }).filter((c) => !seen.has(`${c.name}|${c.start_date}`))
    if (fresh.length === 0) break
    for (const c of fresh) { seen.add(`${c.name}|${c.start_date}`); candidates.push(c) }
  }
  return {
    candidates,
    health: okPages > 0 && candidates.length > 0 ? { id: 'expoassist-us', ok: true, count: candidates.length } : { id: 'expoassist-us', ok: false, count: 0, error: 'no events found' },
  }
}
