import { toCandidateClean } from '../normalize'
import type { Candidate, SourceHealth } from '../types'

const SKIP_SEGMENTS = new Set(['music', 'sports', 'arts & theatre', 'film'])
const PAGE_SIZE = 200
const MAX_RESULTS = 1000 // Discovery API deep-paging cap: size x page < 1000

interface TmEvent { name?: string; url?: string; dates?: { start?: { localDate?: string }; end?: { localDate?: string } }; classifications?: { segment?: { name?: string } }[] }

export async function fetchTicketmaster(
  fetchJson: (url: string) => Promise<unknown | null>,
  apiKey: string | undefined,
  venueIds: { id: string; venue: string; city?: string; state?: string }[],
): Promise<{ candidates: Candidate[]; health: SourceHealth }> {
  const id = 'ticketmaster'
  if (!apiKey) return { candidates: [], health: { id, ok: true, count: 0, error: 'skipped: no key' } }
  const candidates: Candidate[] = []
  let anyOk = false
  for (const v of venueIds) {
    for (let page = 0; (page + 1) * PAGE_SIZE <= MAX_RESULTS; page++) {
      const url = `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${encodeURIComponent(apiKey)}&venueId=${encodeURIComponent(v.id)}&size=${PAGE_SIZE}&page=${page}`
      const data = (await fetchJson(url)) as { _embedded?: { events?: TmEvent[] }; page?: { totalPages?: number } } | null
      if (!data) break
      anyOk = true
      const events = data._embedded?.events ?? []
      for (const e of events) {
        const seg = e.classifications?.[0]?.segment?.name?.toLowerCase()
        if (seg && SKIP_SEGMENTS.has(seg)) continue
        const start = e.dates?.start?.localDate
        const c = toCandidateClean({
          name: e.name ?? '', start_date: start, end_date: e.dates?.end?.localDate ?? start,
          venue: v.venue, city: v.city, state: v.state,
          // The ticketing page is not the organizer's site, so it is deliberately not kept as official_url.
          // The event's own ticket page (never the API URL, which carries the key's query string).
          source: { url: /^https?:\/\//.test(e.url ?? '') ? (e.url as string) : `https://www.ticketmaster.com/venue/${encodeURIComponent(v.id)}`, type: 'api', fetched_at: new Date().toISOString() },
        })
        if (c) candidates.push(c)
      }
      if (events.length === 0 || page + 1 >= (data.page?.totalPages ?? 1)) break
    }
  }
  return { candidates, health: anyOk ? { id, ok: true, count: candidates.length } : { id, ok: false, count: 0, error: 'API requests failed' } }
}
