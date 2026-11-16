import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrate, openDb, withTransaction } from '../../src/db/db'

const tables = (db: ReturnType<typeof openDb>) =>
  (db.prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name").all() as { name: string }[]).map((r) => r.name)

const src = (db: ReturnType<typeof openDb>, id = 's1') => db.prepare("insert into sources(id, kind, family, credibility) values (?, 'directory', 'f', 1)").run(id)
const obs = (db: ReturnType<typeof openDb>, o: Record<string, unknown> = {}) => {
  const v = { source_id: 's1', raw_name: 'CES', start_date: '2027-01-06', city: 'Las Vegas', url: 'https://x.example', evidence_kind: 'directory', seen_at: '2026-11-01', extractor: 'feed', ...o }
  return db.prepare('insert into observations(source_id, raw_name, start_date, city, url, evidence_kind, seen_at, extractor) values (?,?,?,?,?,?,?,?)')
    .run(v.source_id as string, v.raw_name as string, (v.start_date ?? null) as string | null, (v.city ?? null) as string | null, (v.url ?? null) as string | null, v.evidence_kind as string, v.seen_at as string, v.extractor as string)
}

test('openDb creates all tables and sets user_version 1', () => {
  const db = openDb(':memory:')
  expect(tables(db)).toEqual(['event_observations', 'events', 'exclusions', 'fetches', 'inbox', 'ingested', 'observations', 'runs', 'sources'])
  expect((db.prepare('pragma user_version').get() as { user_version: number }).user_version).toBe(3)
})
test('migrate is idempotent and keeps data', () => {
  const db = openDb(':memory:')
  src(db)
  migrate(db)
  migrate(db)
  expect((db.prepare('select count(*) c from sources').get() as { c: number }).c).toBe(1)
})
test('foreign keys are enforced', () => {
  const db = openDb(':memory:')
  expect(() => obs(db, { source_id: 'nope' })).toThrow()
})
test('exact duplicate observations are rejected, including ones with NULL columns', () => {
  const db = openDb(':memory:')
  src(db)
  obs(db)
  expect(() => obs(db)).toThrow()
  obs(db, { city: null, url: null })
  expect(() => obs(db, { city: null, url: null })).toThrow()
})
test('withTransaction commits on success and rolls back everything on error', () => {
  const db = openDb(':memory:')
  withTransaction(db, () => { src(db, 'a') })
  expect(() => withTransaction(db, () => { src(db, 'b'); src(db, 'b') })).toThrow()
  expect((db.prepare('select id from sources order by id').all() as { id: string }[]).map((r) => r.id)).toEqual(['a'])
})
test('nested withTransaction rolls back only the inner block when it throws and is caught', () => {
  const db = openDb(':memory:')
  withTransaction(db, () => {
    src(db, 'outer')
    try { withTransaction(db, () => { src(db, 'inner'); throw new Error('x') }) } catch { /* swallowed */ }
  })
  expect((db.prepare('select id from sources').all() as { id: string }[]).map((r) => r.id)).toEqual(['outer'])
  expect((db.prepare('pragma foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(1)
  expect(() => db.exec('begin')).not.toThrow() // no transaction left open
  db.exec('rollback')
})
test('file databases are created, including parent directories, and persist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'db-'))
  const path = join(dir, 'nested', 'x.db')
  const a = openDb(path)
  src(a)
  a.close()
  const b = openDb(path)
  expect((b.prepare('select count(*) c from sources').get() as { c: number }).c).toBe(1)
})

test('schema version 2 adds exclusions.rule_version; a v1 database migrates in place', async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const { SCHEMA_V1 } = await import('../../src/db/schema')
  const raw = new DatabaseSync(':memory:')
  raw.exec(SCHEMA_V1)
  raw.exec('pragma user_version = 1')
  raw.prepare("insert into exclusions(event_key, reason, name, seen_at) values ('k', 'sports', 'N', '2026-11-01')").run()
  migrate(raw)
  expect((raw.prepare('pragma user_version').get() as { user_version: number }).user_version).toBe(3)
  expect(raw.prepare('select rule_version v from exclusions').get()).toEqual({ v: 1 })
  const fresh = openDb(':memory:')
  expect((fresh.prepare('pragma user_version').get() as { user_version: number }).user_version).toBe(3)
})
