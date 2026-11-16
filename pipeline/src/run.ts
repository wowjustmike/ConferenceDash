import type { ConfEvent } from '../../web/src/lib/schema'
import { config } from './config'
import { classifyKind } from './classify'
import { familyOf, loadCredibility } from './credibility'
import { withTransaction, type Db } from './db/db'
import { addObservation, deleteMissingEvents, linkObservation, loadEvents, markExcluded, recordExclusion, reevaluateExclusions, saveEvents, upsertSource, type ObservationInput, type StoredEvent } from './db/store'
import { hostOf, importEventsJson, KIND } from './importer'
import { isSampleEvent } from './sample'
import { findAmbiguous, mergeCandidates, pairKey, resolveAmbiguous } from './dedupe'
import type { LlmBudget, LlmClient } from './extract/llm'
import { eventId, mergeIntoExisting, reuseId, toConfEvent } from './publish'
import { dueForVerification, type Tier } from './schedule'
import { fetchConfsTech } from './sources/confsTech'
import { runEntry, type RegistryEntry } from './sources/registry'
import { fetchTicketmaster } from './sources/ticketmaster'
import type { Candidate, RunReport, SourceHealth } from './types'
import { verifyOfficialSite, type Verification } from './verify'

export interface RunDeps {
  fetchText: (url: string) => Promise<string | null>
  fetchJson: (url: string) => Promise<unknown | null>
  llm: LlmClient
  budget: LlmBudget
  now: () => Date
  today: Date
  registry: RegistryEntry[]
  /** Events from a previous export; imported into an empty database on first use. */
  existing: ConfEvent[]
  confsYears: number[]
  confsTopics?: string[]
  tmKey: string | undefined
  tmVenues: { id: string; venue: string; city?: string; state?: string }[]
  db: Db
  writeOut: (name: string, data: unknown) => void
}

const usable = (h: SourceHealth) => h.ok && !h.error?.startsWith('skipped')
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export async function runPipeline(args: { tier: Tier; dryRun: boolean; deps: RunDeps }): Promise<RunReport> {
  const { deps: d } = args
  const db = d.db
  const report: RunReport = {
    startedAt: d.now().toISOString(), sources: [], candidates: 0, merged: 0, verified: 0, published: 0, quarantined: 0, archived: 0, llmCalls: 0, errors: [], allSourcesFailed: false,
  }
  const candidates: Candidate[] = []
  const collect = async (id: string, fn: () => Promise<{ candidates: Candidate[]; health: SourceHealth }>) => {
    try {
      const r = await fn()
      candidates.push(...r.candidates)
      report.sources.push(r.health)
    } catch (e) {
      report.sources.push({ id, ok: false, count: 0, error: 'threw' })
      report.errors.push(`${id}: ${(e as Error).message}`)
    }
  }

  // Exclusions made by older classifier rules are re-checked first, so a rule fix can bring wrongly excluded events back.
  if (!args.dryRun) reevaluateExclusions(db)
  // The database is the source of truth; a previous export seeds an empty one.
  let existing: StoredEvent[] = loadEvents(db)
  if (existing.length === 0 && d.existing.length > 0) {
    if (args.dryRun) existing = d.existing
    else { importEventsJson(db, d.existing); existing = loadEvents(db) }
  }
  const excludedKeys = new Set((db.prepare('select event_key k from exclusions').all() as { k: string }[]).map((r) => r.k))

  await collect('confs.tech', () => fetchConfsTech(d.fetchText, d.confsYears, d.confsTopics))
  await collect('ticketmaster', () => fetchTicketmaster(d.fetchJson, d.tmKey, d.tmVenues))
  for (const entry of d.registry) await collect(entry.id, () => runEntry(entry, { fetchText: d.fetchText, llm: d.llm, budget: d.budget, now: d.now }))
  report.candidates = candidates.length
  report.allSourcesFailed = !report.sources.some(usable)

  // Merge duplicates (adjudicating only the ambiguous pairs).
  const pairs = findAmbiguous(candidates)
  const verdicts = await resolveAmbiguous(d.llm, d.budget, pairs)
  const judged = new Map(pairs.map((p, i) => [pairKey(p[0], p[1]), verdicts[i]]))
  const todayIso = isoDay(d.today)
  // Already-ended events are of no use to an upcoming-events directory; existing ones are archived by the merge step.
  const merged = mergeCandidates(candidates, judged).filter((m) => !m.candidate.end_date || m.candidate.end_date >= todayIso)
  report.merged = merged.length

  const known = new Set(existing.map((e) => e.id))
  const fresh: StoredEvent[] = []
  const incomplete: unknown[] = []
  const newExclusions: { key: string; reason: string; name: string }[] = []
  const excludeExisting: { id: string; reason: string }[] = []
  const owner = new Map<MergedEventRef, string>()
  type MergedEventRef = (typeof merged)[number]
  const verifications = new Map<string, Verification>()
  const venueFamilies = new Map<string, Set<string>>()
  const cred = loadCredibility()
  for (const m of merged) {
    const id = reuseId(m.candidate, existing) ?? eventId(m.candidate)
    if (excludedKeys.has(id)) continue
    const cls = classifyKind(m.candidate.name)
    if ('excluded' in cls) {
      newExclusions.push({ key: id, reason: cls.excluded, name: m.candidate.name })
      if (known.has(id)) excludeExisting.push({ id, reason: cls.excluded })
      continue
    }
    const prelim = toConfEvent(m, undefined, d.today, id)
    if (!prelim) { incomplete.push(m.candidate); continue }
    let v: Verification | undefined
    if (!known.has(prelim.id) || dueForVerification(prelim, d.today, args.tier)) {
      try {
        v = await verifyOfficialSite(d.fetchText, d.llm, d.budget, { name: prelim.name, official_url: prelim.official_url, start_date: prelim.start_date, end_date: prelim.end_date, city: prelim.city })
        if (v.reachable) { report.verified++; verifications.set(prelim.id, v) }
      } catch (e) {
        report.errors.push(`verify ${prelim.id}: ${(e as Error).message}`)
      }
    }
    const final: StoredEvent | null = toConfEvent(m, v, d.today, id)
    if (final) {
      if ('kind' in cls) final.kind = cls.kind as string
      fresh.push(final)
      owner.set(m, final.id)
      venueFamilies.set(final.id, new Set(m.members.filter((c) => KIND[c.source.type] === 'venue-calendar').map((c) => familyOf(hostOf(c.source.url), cred))))
    }
  }

  const excludedIds = new Set(excludeExisting.map((x) => x.id))
  const result = mergeIntoExisting(existing.filter((e) => !excludedIds.has(e.id)), fresh, {
    // Sample events are only replaced when a real event matches them; the export threshold decides when the rest are hidden.
    today: d.today, healthy: !report.allSourcesFailed, dropSeed: 'matched',
  })
  report.published = fresh.filter((f) => f.confidence >= config.publishThreshold).length
  report.quarantined = result.quarantined.length
  report.archived = result.archived
  report.llmCalls = d.budget.used

  if (!args.dryRun && !report.allSourcesFailed) {
    try {
      withTransaction(db, () => {
        const register = (type: string, url: string) => {
          const host = hostOf(url)
          const kind = KIND[type] ?? 'aggregator'
          const sourceId = `${type}:${host}`
          upsertSource(db, { id: sourceId, kind, family: familyOf(host, cred), credibility: cred.points[kind] })
          return { sourceId, kind }
        }
        const links: { eventId: string; obs: number }[] = []
        for (const m of merged) {
          const eventId2 = owner.get(m)
          for (const c of m.members) {
            const { sourceId, kind } = register(c.source.type, c.source.url)
            const o = addObservation(db, {
              sourceId, rawName: c.name, startDate: c.start_date, endDate: c.end_date, city: c.city, state: c.state, venue: c.venue, organizer: c.organizer,
              url: c.source.url, evidenceKind: kind, seenAt: c.source.fetched_at.slice(0, 10), extractor: c.source.type,
            } satisfies ObservationInput)
            if (eventId2) links.push({ eventId: eventId2, obs: o.id })
          }
        }
        for (const [id, v] of verifications) {
          const ev = fresh.find((f) => f.id === id)!
          const host = hostOf(ev.official_url)
          // A confirmation found on the venue's own listing page is venue-calendar evidence, not the organizer's site.
          const hosted = venueFamilies.get(id)?.has(familyOf(host, cred)) ?? false
          const evKind = hosted ? 'venue-calendar' : 'official-site'
          const sourceId = `official:${host}`
          upsertSource(db, { id: sourceId, kind: hosted ? 'venue-calendar' : 'organizer-site', family: familyOf(host, cred), credibility: cred.points[evKind] })
          const o = addObservation(db, {
            sourceId, rawName: ev.name, startDate: ev.start_date, endDate: ev.end_date, city: ev.city, state: ev.state, url: ev.official_url,
            evidenceKind: evKind, confirmsEdition: v.datesConfirmed && v.editionYearSeen && !v.cancelled, seenAt: todayIso, extractor: 'verify',
          })
          links.push({ eventId: id, obs: o.id })
        }
        saveEvents(db, result.events, Object.fromEntries(result.events.map((e) => [e.id, { isSample: isSampleEvent(e) }])))
        deleteMissingEvents(db, new Set(result.events.map((e) => e.id)))
        for (const x of newExclusions) recordExclusion(db, x.key, x.reason, x.name, todayIso)
        for (const x of excludeExisting) markExcluded(db, x.id, x.reason)
        const present = new Set(result.events.map((e) => e.id))
        for (const l of links) if (present.has(l.eventId)) linkObservation(db, l.eventId, l.obs, 'rule')
      })
    } catch (e) {
      report.errors.push(`save: ${(e as Error).message}`)
    }
    db.prepare('insert into runs(started_at, finished_at, report_json) values (?, ?, ?)').run(report.startedAt, d.now().toISOString(), JSON.stringify(report))
  }

  d.writeOut('report.json', report)
  d.writeOut('quarantine.json', { quarantined: result.quarantined, incomplete })
  return report
}
