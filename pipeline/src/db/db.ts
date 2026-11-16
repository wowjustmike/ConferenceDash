import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { SCHEMA_V1, SCHEMA_VERSION } from './schema'

export type Db = DatabaseSync

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('pragma foreign_keys = on')
  if (path !== ':memory:') db.exec('pragma journal_mode = wal')
  migrate(db)
  return db
}

export function migrate(db: Db): void {
  const v = (db.prepare('pragma user_version').get() as { user_version: number }).user_version
  if (v >= SCHEMA_VERSION) return
  db.exec('begin')
  try {
    db.exec(SCHEMA_V1)
    db.exec(`pragma user_version = ${SCHEMA_VERSION}`)
    db.exec('commit')
  } catch (e) {
    db.exec('rollback')
    throw e
  }
}

const depth = new WeakMap<Db, number>()

export function withTransaction<T>(db: Db, fn: () => T): T {
  const d = depth.get(db) ?? 0
  const name = `sp${d}`
  db.exec(d === 0 ? 'begin' : `savepoint ${name}`)
  depth.set(db, d + 1)
  try {
    const r = fn()
    db.exec(d === 0 ? 'commit' : `release ${name}`)
    return r
  } catch (e) {
    db.exec(d === 0 ? 'rollback' : `rollback to ${name}; release ${name}`)
    throw e
  } finally {
    depth.set(db, d)
  }
}
