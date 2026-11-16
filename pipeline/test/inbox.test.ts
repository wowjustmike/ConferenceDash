import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/db/db'
import { listInbox, markInbox, saveToInbox } from '../src/inbox'

const dir = () => mkdtempSync(join(tmpdir(), 'inbox-'))

test('saveToInbox writes a text file with a provenance header and a pending row', () => {
  const db = openDb(':memory:'); const d = dir()
  const item = saveToInbox(db, d, { url: 'https://venue.example/events', sourceId: 'venue', text: 'CES 2027 Jan 6-9' })
  expect(existsSync(item.path)).toBe(true)
  const body = readFileSync(item.path, 'utf8')
  expect(body).toContain('URL: https://venue.example/events')
  expect(body).toContain('CES 2027 Jan 6-9')
  expect(listInbox(db, 'pending')).toHaveLength(1)
})
test('saving the same page again updates it instead of duplicating', () => {
  const db = openDb(':memory:'); const d = dir()
  const a = saveToInbox(db, d, { url: 'https://venue.example/events', sourceId: 'venue', text: 'v1' })
  const b = saveToInbox(db, d, { url: 'https://venue.example/events', sourceId: 'venue', text: 'v2 with more' })
  expect(b.id).toBe(a.id)
  expect(readFileSync(b.path, 'utf8')).toContain('v2 with more')
  expect(listInbox(db)).toHaveLength(1)
})
test('markInbox moves items between statuses and records notes', () => {
  const db = openDb(':memory:'); const d = dir()
  const a = saveToInbox(db, d, { url: 'https://a.example', sourceId: 'a', text: 't' })
  markInbox(db, a.id, 'done', '12 events ingested')
  expect(listInbox(db, 'pending')).toHaveLength(0)
  expect(listInbox(db, 'done')[0]).toMatchObject({ id: a.id, notes: '12 events ingested' })
})
