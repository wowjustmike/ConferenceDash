import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { TOPICS, type Topic } from '../../web/src/lib/schema'
import { inWindow } from './classify'
import type { Db } from './db/db'
import { recordExclusion } from './db/store'
import { normalizeDate, normalizeState, toCandidateClean } from './normalize'
import { eventId } from './publish'
import type { Candidate, SourceType } from './types'

const KINDS = { 'venue-calendar': 'claude-venue-calendar', directory: 'claude-directory', aggregator: 'claude-aggregator' } as const

const Record_ = z.object({
  name: z.string().min(1), start_date: z.string(), end_date: z.string().optional(), city: z.string().min(1), state: z.string().min(1),
  venue: z.string().optional(), organizer: z.string().optional(), official_url: z.string().optional(), topics: z.array(z.string()).optional(),
  est_attendance: z.number().nullable().optional(), exclude: z.string().optional(),
  /** A verbatim quote from the saved page that contains the event name (and its dates). */
  evidence: z.string().min(3),
})
const Batch = z.object({ source: z.object({ url: z.string().url(), kind: z.string() }), events: z.array(z.unknown()) })

export interface IngestResult { accepted: number; excluded: number; rejected: { name: string; reason: string }[] }

const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

export function ingestBatch(db: Db, raw: unknown, o: { window: { start: string; end: string }; today: Date }): IngestResult {
  const b = Batch.parse(raw)
  const sourceType: SourceType | undefined = (KINDS as Record<string, SourceType>)[b.source.kind]
  if (!sourceType) throw new Error(`Unknown source kind "${b.source.kind}" (use venue-calendar, directory or aggregator)`)
  const page = db.prepare("select path from inbox where url = ? order by id desc limit 1").get(b.source.url) as { path: string } | undefined
  if (!page) throw new Error(`No saved page for ${b.source.url}: capture it into the inbox first (npm run capture)`)
  const pageText = squash(readFileSync(page.path, 'utf8'))
  const result: IngestResult = { accepted: 0, excluded: 0, rejected: [] }
  const reject = (name: string, reason: string) => result.rejected.push({ name, reason })
  const todayIso = `${o.today.getFullYear()}-${String(o.today.getMonth() + 1).padStart(2, '0')}-${String(o.today.getDate()).padStart(2, '0')}`
  const fetched_at = o.today.toISOString()

  for (const item of b.events) {
    const p = Record_.safeParse(item)
    const label = (item as { name?: string })?.name ?? '(unnamed)'
    if (!p.success) { reject(label, `invalid record: ${p.error.issues[0]?.path.join('.')} ${p.error.issues[0]?.message}`); continue }
    const e = p.data
    const quote = squash(e.evidence)
    if (!pageText.includes(quote)) { reject(e.name, 'evidence not found on the saved page'); continue }
    if (!quote.includes(squash(e.name))) { reject(e.name, 'evidence does not contain the event name'); continue }
    const start = normalizeDate(e.start_date)
    const end = normalizeDate(e.end_date ?? e.start_date)
    if (!start || !end || end < start) { reject(e.name, 'invalid date'); continue }
    const state = normalizeState(e.state)
    if (!state) { reject(e.name, `unknown state "${e.state}"`); continue }
    if (!inWindow({ start_date: start, end_date: end }, o.window)) { reject(e.name, `outside the ${o.window.start}..${o.window.end} window`); continue }
    const topics = (e.topics ?? []).filter((t): t is Topic => (TOPICS as readonly string[]).includes(t))
    const cand = toCandidateClean({
      name: e.name, start_date: start, end_date: end, city: e.city, state: e.state, ...(e.venue ? { venue: e.venue } : {}), ...(e.organizer ? { organizer: e.organizer } : {}),
      ...(e.official_url && /^https?:\/\//i.test(e.official_url) ? { official_url: e.official_url } : {}), ...(topics.length ? { topics } : {}),
      ...(e.est_attendance !== undefined ? { est_attendance: e.est_attendance } : {}), source: { url: b.source.url, type: sourceType, fetched_at },
    })
    if (!cand) { reject(e.name, 'invalid record'); continue }
    if (e.exclude) {
      recordExclusion(db, eventId(cand), e.exclude, cand.name, todayIso)
      result.excluded++
      continue
    }
    const key = createHash('sha1').update(`${b.source.url}|${cand.name.toLowerCase()}|${cand.start_date}`).digest('hex')
    db.prepare(`insert into ingested(key, candidate_json, ingested_at) values (?, ?, ?)
      on conflict(key) do update set candidate_json = excluded.candidate_json, ingested_at = excluded.ingested_at`).run(key, JSON.stringify(cand), fetched_at)
    result.accepted++
  }
  return result
}

/** Candidates previously ingested in-session; every update run merges them with the automatic sources. */
export function loadIngested(db: Db): Candidate[] {
  return (db.prepare('select candidate_json j from ingested order by id').all() as { j: string }[]).map((r) => JSON.parse(r.j) as Candidate)
}
