import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from './db/db'

export interface InboxItem { id: number; url: string; source_id: string | null; path: string; status: string; notes: string | null; created_at: string }

/** Saves rendered page text for a reader (Claude, in-session) and records it as pending. Re-saving the same URL updates it. */
export function saveToInbox(db: Db, dir: string, p: { url: string; sourceId: string; text: string }): InboxItem {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${createHash('sha1').update(p.url).digest('hex').slice(0, 12)}.txt`)
  const now = new Date().toISOString()
  writeFileSync(path, `URL: ${p.url}\nFETCHED: ${now}\n---\n${p.text}\n`)
  const row = db.prepare('select id from inbox where path = ?').get(path) as { id: number } | undefined
  if (row) {
    db.prepare("update inbox set status = 'pending', created_at = ? where id = ?").run(now, row.id)
    return { id: row.id, url: p.url, source_id: p.sourceId, path, status: 'pending', notes: null, created_at: now }
  }
  const r = db.prepare('insert into inbox(url, source_id, path, status, created_at) values (?, ?, ?, ?, ?)').run(p.url, null, path, 'pending', now)
  return { id: Number(r.lastInsertRowid), url: p.url, source_id: p.sourceId, path, status: 'pending', notes: null, created_at: now }
}

export function listInbox(db: Db, status?: string): InboxItem[] {
  return (status
    ? db.prepare('select * from inbox where status = ? order by id').all(status)
    : db.prepare('select * from inbox order by id').all()) as unknown as InboxItem[]
}

export function markInbox(db: Db, id: number, status: 'pending' | 'done' | 'skipped', notes?: string): void {
  db.prepare('update inbox set status = ?, notes = coalesce(?, notes) where id = ?').run(status, notes ?? null, id)
}
