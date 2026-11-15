import { normalizeDate, normalizeState, toCandidateClean } from '../normalize'
import type { Candidate, SourceRef } from '../types'

interface Prop { params: Record<string, string>; value: string }

function unfold(text: string): string[] {
  const out: string[] = []
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && out.length) out[out.length - 1] += raw.slice(1)
    else out.push(raw)
  }
  return out
}

function parseLine(line: string): [string, Prop] | null {
  const i = line.indexOf(':')
  if (i < 0) return null
  const [name, ...ps] = line.slice(0, i).split(';')
  const params: Record<string, string> = {}
  for (const p of ps) { const [k, v] = p.split('='); if (k && v) params[k.toUpperCase()] = v.replace(/^"|"$/g, '') }
  return [name.toUpperCase(), { params, value: line.slice(i + 1) }]
}

const unescapeText = (s: string) => s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim()

function icsDate(p: Prop): { iso: string | null; allDay: boolean } {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(p.value.trim())
  if (!m) return { iso: null, allDay: false }
  return { iso: normalizeDate(`${m[1]}-${m[2]}-${m[3]}`), allDay: p.params.VALUE === 'DATE' || /^\d{8}$/.test(p.value.trim()) }
}

function minusDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d - 1))
  return dt.toISOString().slice(0, 10)
}

function parseLocation(loc: string, defaults: { venue?: string; city?: string; state?: string }) {
  const parts = loc.split(',').map((s) => s.trim()).filter(Boolean)
  for (let i = parts.length - 1; i > 0; i--) {
    const m = /^([A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/.exec(parts[i])
    if (m && normalizeState(m[1])) return { venue: parts[0], city: parts[i - 1], state: m[1] }
  }
  return { venue: parts[0] || defaults.venue, city: defaults.city, state: defaults.state }
}

export function parseIcs(text: string, source: SourceRef, defaults: { venue?: string; city?: string; state?: string } = {}): Candidate[] {
  const out: Candidate[] = []
  let cur: Record<string, Prop> | null = null
  for (const line of unfold(text)) {
    if (line.trim().toUpperCase() === 'BEGIN:VEVENT') { cur = {}; continue }
    if (line.trim().toUpperCase() === 'END:VEVENT') {
      if (cur) { const c = build(cur, source, defaults); if (c) out.push(c) }
      cur = null
      continue
    }
    if (cur) { const kv = parseLine(line); if (kv && !(kv[0] in cur)) cur[kv[0]] = kv[1] }
  }
  return out
}

function build(p: Record<string, Prop>, source: SourceRef, defaults: { venue?: string; city?: string; state?: string }): Candidate | null {
  if (!p.SUMMARY || !p.DTSTART) return null
  const s = icsDate(p.DTSTART)
  if (!s.iso) return null
  let end = s.iso
  if (p.DTEND) {
    const e = icsDate(p.DTEND)
    if (e.iso) end = e.allDay ? minusDay(e.iso) : e.iso
  }
  if (end < s.iso) end = s.iso
  const loc = parseLocation(p.LOCATION ? unescapeText(p.LOCATION.value) : '', defaults)
  const org = p.ORGANIZER?.params.CN
  return toCandidateClean({
    name: unescapeText(p.SUMMARY.value), start_date: s.iso, end_date: end, ...loc,
    ...(org ? { organizer: org } : {}), ...(p.URL ? { official_url: p.URL.value.trim() } : {}), source,
  })
}
