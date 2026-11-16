import { readFileSync } from 'node:fs'
import type { Topic } from '../../web/src/lib/schema'
import type { Candidate } from './types'

const aliases = JSON.parse(readFileSync(new URL('../sources/aliases.json', import.meta.url), 'utf8')) as {
  cities: Record<string, string>
  venues: Record<string, string>
}

const STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
}
const CITY_STATE = new Map(
  Object.entries(JSON.parse(readFileSync(new URL('../sources/cities.json', import.meta.url), 'utf8')) as Record<string, string>).map(([c, st]) => [c.toLowerCase(), st]),
)

/** State for a well-known US conference city (used when a source gives a city but no state). */
export function cityToState(city: string): string | null {
  const st = CITY_STATE.get(city.trim().toLowerCase().replace(/\s+/g, ' '))
  return st ? normalizeState(st) : null
}

const STATE_NAMES = new Map(Object.values(STATES).map((n) => [n.toLowerCase(), n]))

export function normalizeState(s: string): string | null {
  const t = s.trim()
  return STATES[t.toUpperCase()] ?? STATE_NAMES.get(t.toLowerCase()) ?? null
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (m) => m.toUpperCase())
const ci = (map: Record<string, string>) => new Map(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]))
const CITY_ALIAS = ci(aliases.cities)
const VENUE_ALIAS = ci(aliases.venues)

export function normalizeCity(city: string): string {
  const t = city.trim().replace(/\s+/g, ' ')
  return CITY_ALIAS.get(t.toLowerCase()) ?? titleCase(t)
}

export function normalizeVenue(v: string): string {
  const t = v.trim().replace(/\s+/g, ' ')
  return VENUE_ALIAS.get(t.toLowerCase()) ?? t
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad = (n: number) => String(n).padStart(2, '0')

function valid(y: number, m: number, d: number): string | null {
  const dt = new Date(y, m - 1, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

export function normalizeDate(s: string): string | null {
  const t = s.trim()
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/.exec(t)
  if (m) return valid(+m[1], +m[2], +m[3])
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(t)
  if (m) { const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()); return mi < 0 ? null : valid(+m[3], mi + 1, +m[2]) }
  m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(t)
  if (m) { const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()); return mi < 0 ? null : valid(+m[3], mi + 1, +m[1]) }
  return null
}

const TOPIC_WORDS: [Topic, RegExp][] = [
  ['Cannabis', /\b(cannabis|mjbiz\w*|marijuana|hemp)\b/i],
  ['Healthcare', /\b(health\w*|medical|himss|pharma\w*|nursing|radiolog\w*|rsna)\b/i],
  ['Finance', /\b(fintech|money20\/20|banking|finance|financial|insurance)\b/i],
  ['Gaming', /\b(gaming|games?|esports|g2e)\b/i],
  ['Marketing', /\b(marketing|advertising|adobe summit|seo)\b/i],
  ['Energy', /\b(energy|solar|oil|gas|ceraweek|re\+|utilities)\b/i],
  ['Media', /\b(broadcast\w*|media|nab show|podcast\w*)\b/i],
  ['Hospitality', /\b(restaurant|hospitality|hotel|lodging|food)\b/i],
  ['Automotive', /\b(auto|automotive|cars?|vehicles?|sema)\b/i],
  ['Aviation', /\b(aviation|aircraft|airshow|nbaa)\b/i],
  ['Retail', /\b(retail|nrf|merchandise|expo west|consumer products)\b/i],
  ['Entertainment', /\b(anime|film|music|entertainment|comic|festival)\b/i],
  ['Education', /\b(education|edu|learning|teachers?)\b/i],
  ['Sports', /\b(sports?|golf|pga)\b/i],
  ['Tech', /\b(tech\w*|ai|cloud|cyber\w*|software|developers?|data|black hat|ces|devops|security|re:invent|summit)\b/i],
]

export function guessTopics(name: string, hint = ''): Topic[] {
  const text = `${name} ${hint}`
  const found = TOPIC_WORDS.filter(([, re]) => re.test(text)).map(([t]) => t)
  return found.length ? found : ['Other']
}

export function toCandidateClean(c: Candidate): Candidate | null {
  const name = c.name?.trim()
  if (!name) return null
  const out: Candidate = { ...c, name }
  if (c.start_date !== undefined) {
    const s = normalizeDate(c.start_date)
    if (!s) return null
    out.start_date = s
    const e = c.end_date !== undefined ? normalizeDate(c.end_date) : s
    if (!e || e < s) return null
    out.end_date = e
  } else if (c.end_date !== undefined) {
    return null
  }
  if (c.state !== undefined) {
    const st = normalizeState(c.state)
    if (st) out.state = st
    else delete out.state
  }
  if (c.city) out.city = normalizeCity(c.city)
  if (c.venue) out.venue = normalizeVenue(c.venue)
  return out
}
