import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { loadCredibility, scoreSignal, type Signal } from './credibility'
import type { Db } from './db/db'
import { evidenceFor, loadEvents, type StoredEvent } from './db/store'
import { inWindow } from './classify'
import { atomicWrite, validateEvents } from './publish'
import { isSampleEvent } from './sample'

export type ExportEvent = StoredEvent & { signal: Signal }

export function recomputeSignals(db: Db, today: Date): number {
  const cred = loadCredibility()
  const events = loadEvents(db)
  let changed = 0
  const conflicts = db.prepare(`select count(*) c from event_observations eo join observations o on o.id = eo.observation_id join events e on e.id = eo.event_id
    where eo.event_id = ? and o.evidence_kind != 'seed' and o.start_date is not null and (o.start_date != e.start_date or coalesce(o.end_date, o.start_date) != e.end_date)`)
  const update = db.prepare('update events set signal_points = ?, signal_bars = ?, signal_json = ? where id = ?')
  for (const e of events) {
    const conflicting = (conflicts.get(e.id) as { c: number }).c > 0
    const signal = scoreSignal(evidenceFor(db, e.id), { conflictingDates: conflicting, today, c: cred })
    const json = JSON.stringify(signal)
    if (JSON.stringify(e.signal ?? null) !== json) { update.run(signal.points, signal.bars, json, e.id); changed++ }
  }
  return changed
}

export function buildExport(db: Db, o: { windowStart: string; windowEnd: string; sampleDropThreshold: number; today: Date }): ExportEvent[] {
  const inRange = loadEvents(db).filter((e) => e.status === 'active' && inWindow(e, { start: o.windowStart, end: o.windowEnd }))
  const real = inRange.filter((e) => !isSampleEvent(e))
  const dropSamples = real.length >= o.sampleDropThreshold
  return inRange
    .filter((e) => !(dropSamples && isSampleEvent(e)))
    .map((e) => ({ ...e, signal: e.signal ?? { points: 0, bars: 1 as const, evidence: [], flags: [] } }))
    .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.name.localeCompare(b.name))
}

export type ExportPlan =
  | { single: ExportEvent[] }
  | { shards: Map<string, ExportEvent[]>; index: { months: string[]; counts: Record<string, number> } }

export function planShards(events: ExportEvent[], maxBytes: number): ExportPlan {
  if (Buffer.byteLength(JSON.stringify(events)) <= maxBytes) return { single: events }
  const shards = new Map<string, ExportEvent[]>()
  for (const e of events) {
    const m = e.start_date.slice(0, 7)
    shards.set(m, [...(shards.get(m) ?? []), e])
  }
  const months = [...shards.keys()].sort()
  return { shards, index: { months, counts: Object.fromEntries(months.map((m) => [m, shards.get(m)!.length])) } }
}

export function writeExport(dir: string, plan: ExportPlan): void {
  mkdirSync(dir, { recursive: true })
  const shardDir = join(dir, 'events')
  if ('single' in plan) {
    validateEvents(plan.single)
    atomicWrite(join(dir, 'events.json'), JSON.stringify(plan.single, null, 2) + '\n')
    if (existsSync(shardDir)) rmSync(shardDir, { recursive: true, force: true })
    return
  }
  const all = [...plan.shards.values()].flat()
  validateEvents(all) // validate everything before touching any file
  mkdirSync(shardDir, { recursive: true })
  for (const [month, evs] of plan.shards) atomicWrite(join(shardDir, `${month}.json`), JSON.stringify(evs, null, 2) + '\n')
  for (const f of readdirSync(shardDir)) if (!plan.index.months.includes(f.replace(/\.json$/, ''))) rmSync(join(shardDir, f), { force: true })
  atomicWrite(join(dir, 'events.json'), JSON.stringify({ shards: plan.index.months.map((m) => `events/${m}.json`) }, null, 2) + '\n')
}
