import { toCandidateClean } from '../normalize'
import type { Candidate, SourceHealth } from '../types'

const BASE = 'https://raw.githubusercontent.com/tech-conferences/conference-data/main/conferences'

export const DEFAULT_TOPICS = [
  'javascript', 'typescript', 'devops', 'data', 'security', 'ux', 'python', 'golang', 'ruby', 'php', 'dotnet', 'java', 'rust',
  'android', 'ios', 'kotlin', 'css', 'accessibility', 'cloud-native', 'general', 'ai', 'networking', 'leadership', 'scala',
  'elixir', 'product', 'tech-comm',
]

interface Row { name?: unknown; url?: unknown; startDate?: unknown; endDate?: unknown; city?: unknown; country?: unknown; online?: unknown }
const s = (v: unknown) => (typeof v === 'string' ? v : undefined)

export async function fetchConfsTech(
  fetchText: (url: string) => Promise<string | null>,
  years: number[],
  topics: string[] = DEFAULT_TOPICS,
): Promise<{ candidates: Candidate[]; health: SourceHealth }> {
  const candidates: Candidate[] = []
  let filesOk = 0
  for (const year of years) {
    for (const topic of topics) {
      const url = `${BASE}/${year}/${topic}.json`
      const text = await fetchText(url)
      if (text === null) continue
      let rows: unknown
      try { rows = JSON.parse(text) } catch { continue }
      if (!Array.isArray(rows)) continue
      filesOk++
      const fetched_at = new Date().toISOString()
      for (const r of rows as Row[]) {
        if (r.country !== 'U.S.A.' || r.online === true) continue
        const place = s(r.city) ?? ''
        const m = /^(.+),\s*([A-Za-z]{2})$/.exec(place)
        const c = toCandidateClean({
          name: s(r.name) ?? '', start_date: s(r.startDate), end_date: s(r.endDate) ?? s(r.startDate),
          city: m ? m[1] : place || undefined, ...(m ? { state: m[2] } : {}),
          official_url: s(r.url), topics: ['Tech'], source: { url, type: 'confs.tech', fetched_at },
        })
        if (c) candidates.push(c)
      }
    }
  }
  return {
    candidates,
    health: filesOk > 0 ? { id: 'confs.tech', ok: true, count: candidates.length } : { id: 'confs.tech', ok: false, count: 0, error: 'no topic files could be fetched' },
  }
}
