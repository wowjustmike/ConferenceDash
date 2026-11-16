import type { ConfEvent } from '../../web/src/lib/schema'
import { withTransaction, type Db } from './db/db'
import { looksSame } from './dedupe'
import type { Candidate } from './types'

export interface AliasLink { alias: string; of: string }
const MAX_SOURCES = 10

const asCandidate = (e: ConfEvent): Candidate => ({ name: e.name, start_date: e.start_date, end_date: e.end_date, city: e.city, state: e.state, official_url: e.official_url, source: { url: e.official_url, type: 'jsonld', fetched_at: e.last_verified } })

interface Row { id: string; name: string; start_date: string; end_date: string; city: string; state: string; official_url: string; last_verified: string; signal_points: number; sources_json: string }
const rows = (db: Db) => db.prepare(`select id, name, start_date, end_date, city, state, official_url, last_verified, signal_points, sources_json from events
  where excluded_reason is null and alias_of is null and status = 'active' order by start_date, name`).all() as unknown as Row[]
const sourcesOf = (r: Row) => JSON.parse(r.sources_json) as ConfEvent['sources']
/** Higher signal wins; then more sources; then the lexically smaller id, so the choice is deterministic. */
const stronger = (a: Row, b: Row) => a.signal_points - b.signal_points || sourcesOf(a).length - sourcesOf(b).length || (a.id < b.id ? 1 : -1)

/** Re-points an alias row's observations and sources at its survivor (idempotent; a later run may have written to the alias id again). */
function relink(db: Db, alias: string, of: string): void {
  db.prepare('insert or ignore into event_observations(event_id, observation_id, decided_by) select ?, observation_id, decided_by from event_observations where event_id = ?').run(of, alias)
  const sources = (id: string) => JSON.parse((db.prepare('select sources_json j from events where id = ?').get(id) as { j: string }).j) as ConfEvent['sources']
  const seen = new Set<string>()
  const merged = [...sources(of), ...sources(alias)].filter((x) => { const k = `${x.type}|${x.url}`; if (seen.has(k)) return false; seen.add(k); return true }).slice(0, MAX_SOURCES)
  db.prepare('update events set sources_json = ? where id = ?').run(JSON.stringify(merged), of)
}

/**
 * Collapses stored rows that describe the same event (same year and city, names that `looksSame`) into one survivor each.
 * The loser keeps its row and id but gets `alias_of`, so it is never exported, re-scored or deleted, and ids never change.
 * Returns the links made this call; existing aliases are only re-linked.
 */
export function collapseAliases(db: Db): AliasLink[] {
  const made: AliasLink[] = []
  withTransaction(db, () => {
    const vetoed = new Set((db.prepare('select a, b from alias_vetoes').all() as { a: string; b: string }[]).map((v) => `${v.a}|${v.b}`))
    const isVetoed = (x: string, y: string) => vetoed.has(`${x}|${y}`) || vetoed.has(`${y}|${x}`)
    const buckets = new Map<string, Row[]>()
    for (const r of rows(db)) { const k = `${r.start_date.slice(0, 4)}|${r.city.toLowerCase()}`; buckets.set(k, [...(buckets.get(k) ?? []), r]) }
    const gone = new Set<string>()
    for (const list of buckets.values()) {
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j]
        if (gone.has(a.id) || gone.has(b.id) || isVetoed(a.id, b.id)) continue
        if (!looksSame(asCandidate(a as unknown as ConfEvent), asCandidate(b as unknown as ConfEvent))) continue
        const [loser, winner] = stronger(a, b) > 0 ? [b, a] : [a, b]
        db.prepare('update events set alias_of = ? where id = ?').run(winner.id, loser.id)
        gone.add(loser.id)
        made.push({ alias: loser.id, of: winner.id })
      }
    }
    for (const l of db.prepare('select id, alias_of a from events where alias_of is not null').all() as { id: string; a: string }[]) relink(db, l.id, l.a)
  })
  return made
}

/** Undoes a wrong alias and remembers the pair so collapseAliases does not make it again. Returns false if the id is not an alias. */
export function unalias(db: Db, id: string): boolean {
  const row = db.prepare('select alias_of a from events where id = ?').get(id) as { a: string | null } | undefined
  if (!row?.a) return false
  withTransaction(db, () => {
    db.prepare('insert or ignore into alias_vetoes(a, b) values (?, ?)').run(id, row.a)
    db.prepare('update events set alias_of = null where id = ?').run(id)
  })
  return true
}
