import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../src/db/db'
import { addObservation, linkObservation, markExcluded, saveEvents, upsertSource, type StoredEvent } from '../src/db/store'
import { buildExport, planShards, recomputeSignals, writeExport } from '../src/exporter'

const today = new Date('2026-11-15T12:00:00Z')
const mk = (id: string, o: Partial<StoredEvent> = {}): StoredEvent => ({
  id, name: id.toUpperCase(), start_date: '2027-03-10', end_date: '2027-03-12', dates_confirmed: true, city: 'Las Vegas', state: 'Nevada', venue: '', organizer: '',
  topics: ['Tech'], est_attendance: null, official_url: `https://${id}.example`,
  sources: [{ url: `https://${id}.example`, type: 'jsonld', fetched_at: '2026-11-10T00:00:00Z' }], last_verified: '2026-11-10', confidence: 0.9, status: 'active', ...o,
})
const win = { windowStart: '2026-11-15', windowEnd: '2027-12-31', sampleDropThreshold: 100, today }

function seedSources(db: Db) {
  upsertSource(db, { id: 'agg1', kind: 'aggregator', family: 'agg1.com', credibility: 1 })
  upsertSource(db, { id: 'agg2', kind: 'aggregator', family: 'agg2.com', credibility: 1 })
  upsertSource(db, { id: 'org', kind: 'organizer-site', family: 'org.com', credibility: 3 })
  upsertSource(db, { id: 'seed', kind: 'seed', family: 'seed', credibility: 0 })
}
function observe(db: Db, eventId: string, sourceId: string, kind: 'aggregator' | 'official-site' | 'seed', o: { confirms?: boolean; seen?: string; start?: string } = {}) {
  const r = addObservation(db, { sourceId, rawName: eventId, startDate: o.start ?? '2027-03-10', endDate: '2027-03-12', city: 'Las Vegas', url: `https://${sourceId}.example/${eventId}`, evidenceKind: kind, confirmsEdition: o.confirms, seenAt: o.seen ?? '2026-11-10', extractor: 't' })
  linkObservation(db, eventId, r.id, 'rule')
}

test('recomputeSignals: official confirmation -> 3 bars; single aggregator -> 1; last-year page stays 1', () => {
  const db = openDb(':memory:'); seedSources(db)
  saveEvents(db, [mk('official'), mk('single'), mk('lastyear'), mk('three')])
  observe(db, 'official', 'org', 'official-site', { confirms: true })
  observe(db, 'single', 'agg1', 'aggregator')
  observe(db, 'lastyear', 'org', 'official-site', { confirms: false })
  observe(db, 'three', 'agg1', 'aggregator'); observe(db, 'three', 'agg2', 'aggregator'); observe(db, 'three', 'org', 'official-site', { confirms: false })
  const changed = recomputeSignals(db, today)
  expect(changed).toBe(4)
  const bars = Object.fromEntries((db.prepare('select id, signal_bars b from events').all() as { id: string; b: number }[]).map((r) => [r.id, r.b]))
  expect(bars).toEqual({ official: 3, single: 1, lastyear: 1, three: 2 })
  expect(recomputeSignals(db, today)).toBe(0) // unchanged -> idempotent
})
test('recomputeSignals flags conflicting dates from linked observations', () => {
  const db = openDb(':memory:'); seedSources(db)
  saveEvents(db, [mk('c1')])
  observe(db, 'c1', 'org', 'official-site', { confirms: true })
  observe(db, 'c1', 'agg1', 'aggregator', { start: '2027-03-11' })
  recomputeSignals(db, today)
  const row = db.prepare('select signal_bars b, signal_json j from events').get() as { b: number; j: string }
  expect(JSON.parse(row.j).flags).toContain('conflicting-dates')
})
test('buildExport drops excluded, cancelled, past and out-of-window events; adds a default signal', () => {
  const db = openDb(':memory:'); seedSources(db)
  saveEvents(db, [mk('ok'), mk('cancel', { status: 'cancelled' }), mk('past', { status: 'past' }), mk('early', { start_date: '2026-01-01', end_date: '2026-01-02' }),
    mk('late', { start_date: '2028-02-01', end_date: '2028-02-02' }), mk('fest')])
  markExcluded(db, 'fest', 'festival')
  const ex = buildExport(db, win)
  expect(ex.map((e) => e.id)).toEqual(['ok'])
  expect(ex[0].signal).toBeTruthy()
})
test('sample events stay below the threshold and vanish at it', () => {
  const db = openDb(':memory:'); seedSources(db)
  const sample = mk('sample1', { sources: [{ url: 'https://s.example', type: 'seed', fetched_at: '2026-11-01T00:00:00Z' }] })
  saveEvents(db, [sample, mk('real1'), mk('real2')], { sample1: { isSample: true } })
  expect(buildExport(db, { ...win, sampleDropThreshold: 3 }).map((e) => e.id).sort()).toEqual(['real1', 'real2', 'sample1'])
  expect(buildExport(db, { ...win, sampleDropThreshold: 2 }).map((e) => e.id).sort()).toEqual(['real1', 'real2'])
})
const many = (n: number) => Array.from({ length: n }, (_, i) => mk(`e${i}`, { start_date: `2027-${String((i % 4) + 1).padStart(2, '0')}-10`, end_date: `2027-${String((i % 4) + 1).padStart(2, '0')}-11` }) as never)
test('planShards: single under the limit; shards over it with every event exactly once', () => {
  const evs = many(40)
  expect('single' in planShards(evs, 10_000_000)).toBe(true)
  const plan = planShards(evs, 500)
  if (!('shards' in plan)) throw new Error('expected shards')
  const all = [...plan.shards.values()].flat().map((e) => e.id)
  expect(all).toHaveLength(40)
  expect(new Set(all).size).toBe(40)
  expect(plan.index.months).toEqual(['2027-01', '2027-02', '2027-03', '2027-04'])
  expect(Object.values(plan.index.counts).reduce((a, b) => a + b, 0)).toBe(40)
})
test('writeExport single: writes events.json atomically; invalid data leaves the old file untouched', () => {
  const dir = mkdtempSync(join(tmpdir(), 'exp-'))
  writeFileSync(join(dir, 'events.json'), '[]\n')
  writeExport(dir, { single: [mk('a') as never] })
  expect(JSON.parse(readFileSync(join(dir, 'events.json'), 'utf8'))).toHaveLength(1)
  const before = readFileSync(join(dir, 'events.json'), 'utf8')
  expect(() => writeExport(dir, { single: [mk('a') as never, { ...mk('b'), name: '' } as never] })).toThrow()
  expect(readFileSync(join(dir, 'events.json'), 'utf8')).toBe(before)
})
test('writeExport sharded: manifest + shard files, stale shards removed, switching back to single cleans up', () => {
  const dir = mkdtempSync(join(tmpdir(), 'exp-'))
  const plan = planShards(many(40), 500)
  writeExport(dir, plan)
  const manifest = JSON.parse(readFileSync(join(dir, 'events.json'), 'utf8'))
  expect(manifest.shards).toHaveLength(4)
  expect(readdirSync(join(dir, 'events')).sort()).toEqual(['2027-01.json', '2027-02.json', '2027-03.json', '2027-04.json'])
  writeExport(dir, planShards(many(40).slice(0, 10), 500))
  expect(existsSync(join(dir, 'events'))).toBe(true)
  writeExport(dir, { single: [mk('a') as never] })
  expect(Array.isArray(JSON.parse(readFileSync(join(dir, 'events.json'), 'utf8')))).toBe(true)
  expect(existsSync(join(dir, 'events'))).toBe(false)
})

test('a confirmation revoked by a later non-confirming check no longer earns points or looks fresh', () => {
  const db = openDb(':memory:'); seedSources(db)
  saveEvents(db, [mk('revoked')])
  observe(db, 'revoked', 'org', 'official-site', { confirms: true, seen: '2026-01-01' })
  observe(db, 'revoked', 'org', 'official-site', { confirms: false, seen: '2026-11-15' })
  recomputeSignals(db, today)
  const row = db.prepare('select signal_bars b, signal_points p from events').get() as { b: number; p: number }
  expect(row).toEqual({ b: 1, p: 0 })
})
