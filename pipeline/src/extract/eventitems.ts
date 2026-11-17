import * as cheerio from 'cheerio'
import { normalizeDate, toCandidateClean } from '../normalize'
import type { Candidate, SourceRef } from '../types'

const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const DASH = '\\s*[-–—]\\s*'
const mk = (m: string, d: string | number, y: string | number) => normalizeDate(`${m} ${d}, ${y}`)

/** Parses "Nov 20 - 29, 2026", "Dec 5, 2026", "Nov 30 - Dec 4, 2026", "Dec 30, 2026 - Jan 2, 2027". */
export function parseDateRangeText(text: string): { start: string; end: string } | null {
  const t = text.replace(/\s+/g, ' ').trim()
  let m = new RegExp(`^(${MONTH})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})${DASH}(${MONTH})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})$`, 'i').exec(t)
  if (m) return pair(mk(m[1], m[2], m[3]), mk(m[4], m[5], m[6]))
  m = new RegExp(`^(${MONTH})\\.?\\s+(\\d{1,2})${DASH}(${MONTH})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})$`, 'i').exec(t)
  if (m) return pair(mk(m[1], m[2], m[5]), mk(m[3], m[4], m[5]))
  m = new RegExp(`^(${MONTH})\\.?\\s+(\\d{1,2})${DASH}(\\d{1,2}),?\\s+(\\d{4})$`, 'i').exec(t)
  if (m) return pair(mk(m[1], m[2], m[4]), mk(m[1], m[3], m[4]))
  m = new RegExp(`^(${MONTH})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})$`, 'i').exec(t)
  if (m) { const d = mk(m[1], m[2], m[3]); return pair(d, d) }
  return null
}
const pair = (a: string | null, b: string | null) => (a && b && b >= a ? { start: a, end: b } : null)

/**
 * Parses "Nov 20 - 22", "Nov 30 - Dec 4", "Dec 30 - Jan 2", "Jan 6" (no year): the next occurrence that is not long past,
 * the same rule the Simpleview readers use (45 days of grace), with an end that wraps into the next year when it precedes the start.
 */
export function parseMonthDayRange(text: string, today: Date): { start: string; end: string } | null {
  const t = text.replace(/\s+/g, ' ').trim()
  const m = new RegExp(`^(${MONTH})\\.?\\s+(\\d{1,2})(?:${DASH}(?:(${MONTH})\\.?\\s+)?(\\d{1,2}))?$`, 'i').exec(t)
  if (!m) return null
  let y = today.getFullYear()
  const probe = normalizeDate(`${m[1]} ${m[2]}, ${y}`)
  if (!probe) return null
  if (new Date(`${probe}T12:00:00`).getTime() < today.getTime() - 45 * 864e5) y++
  const start = mk(m[1], m[2], y)
  if (!start) return null
  if (!m[4]) return pair(start, start)
  let end = mk(m[3] ?? m[1], m[4], y)
  // Only a range that names a second month ("Dec 30 - Jan 2") may wrap into the next year; "Nov 20 - 19" stays invalid.
  if (end && end < start && m[3]) end = mk(m[3], m[4], y + 1)
  return pair(start, end)
}

/** Reads the common convention-center card layout: `.eventItem` with a `.date` line and an `h3.title a` link. */
export function parseEventItems(
  html: string, source: SourceRef, defaults: { venue?: string; city?: string; state?: string } = {}, exclude: string[] = [], excludeCategories: string[] = [],
): Candidate[] {
  const $ = cheerio.load(html)
  const bad = exclude.map((p) => new RegExp(p, 'i'))
  const out: Candidate[] = []
  $('.eventItem').each((_, el) => {
    const card = $(el)
    const a = card.find('h3.title a, .title a').first()
    const name = a.text().replace(/\s+/g, ' ').trim()
    const range = parseDateRangeText(card.find('.date').first().text().replace(/\./g, '. ').replace(/\s+\./g, '.'))
    const category = card.find('.event_category').first().text().replace(/\s+/g, ' ').trim().toLowerCase()
    if (!name || !range || bad.some((re) => re.test(name)) || (category && excludeCategories.some((c) => category.includes(c.toLowerCase())))) return
    // Some cards link the organizer's own site ("Event Website"); prefer it over the venue's detail page.
    let organizerSite: string | undefined
    card.find('.buttons a').each((_, el) => {
      const t = $(el).text().trim()
      if (/event website/i.test(t) && !organizerSite) { try { const u = new URL($(el).attr('href') ?? '', source.url); if (u.protocol === 'http:' || u.protocol === 'https:') organizerSite = u.toString() } catch { /* none */ } }
    })
    let url: string | undefined
    try { const u = new URL(a.attr('href') ?? '', source.url); if (u.protocol === 'http:' || u.protocol === 'https:') url = u.toString() } catch { /* no url */ }
    const c = toCandidateClean({ name, start_date: range.start, end_date: range.end, ...defaults, ...((organizerSite ?? url) ? { official_url: organizerSite ?? url } : {}), source })
    if (c) out.push(c)
  })
  return out
}
