import { familyOf, loadCredibility, scoreSignal, type Evidence } from '../src/credibility'

const c = loadCredibility()
const today = new Date('2026-11-15T12:00:00Z')
const ev = (family: string, kind: Evidence['kind'], o: Partial<Evidence> = {}): Evidence => ({ family, kind, confirmsEdition: true, seenAt: '2026-11-10', label: `${family} listing`, ...o })
const score = (list: Evidence[], conflicting = false) => scoreSignal(list, { conflictingDates: conflicting, today, c })

test.each([
  ['one aggregator', [ev('a', 'aggregator')], 1, 1],
  ['two aggregators in different families', [ev('a', 'aggregator'), ev('b', 'aggregator')], 2, 2],
  ['three aggregators in different families', [ev('a', 'aggregator'), ev('b', 'aggregator'), ev('c', 'aggregator')], 3, 3],
  ['three aggregators copying one family count once', [ev('a', 'aggregator'), ev('a', 'aggregator'), ev('a', 'aggregator')], 1, 1],
  ['official site confirming this edition', [ev('org', 'official-site')], 3, 3],
  ['official site showing only last year', [ev('org', 'official-site', { confirmsEdition: false })], 0, 1],
  ['confirmed ticketing listing', [ev('tm', 'ticketing')], 3, 3],
  ['a dated ticketing listing counts for its own edition even without a separate confirmation', [ev('tm', 'ticketing', { confirmsEdition: false })], 3, 3],
  ['venue calendar alone', [ev('lvcva', 'venue-calendar')], 2, 2],
  ['venue calendar plus directory', [ev('lvcva', 'venue-calendar'), ev('confs.tech', 'directory')], 3, 3],
  ['sample data only', [ev('seed', 'seed')], 0, 1],
  ['no evidence', [], 0, 1],
] as [string, Evidence[], number, number][])('%s', (_n, list, points, bars) => {
  const s = score(list)
  expect(s.points).toBe(points)
  expect(s.bars).toBe(bars)
})

test('within one family only the best evidence counts', () => {
  expect(score([ev('x', 'aggregator'), ev('x', 'venue-calendar')]).points).toBe(2)
})
test('conflicting dates remove a point and flag it', () => {
  const s = score([ev('org', 'official-site')], true)
  expect(s.points).toBe(2)
  expect(s.bars).toBe(2)
  expect(s.flags).toContain('conflicting-dates')
})
test('stale evidence (older than 60 days) removes a point and flags it', () => {
  const s = score([ev('org', 'official-site', { seenAt: '2026-08-01' })])
  expect(s.points).toBe(2)
  expect(s.flags).toContain('stale')
  expect(score([ev('org', 'official-site', { seenAt: '2026-10-01' })]).flags).not.toContain('stale')
})
test('penalties never take a visible event below 1 bar or 0 points', () => {
  const s = score([ev('a', 'aggregator', { seenAt: '2026-01-01' })], true)
  expect(s.bars).toBe(1)
  expect(s.points).toBe(0)
})
test('evidence list names each family with its points', () => {
  const s = score([ev('lvcva', 'venue-calendar'), ev('confs.tech', 'directory')])
  expect(s.evidence.map((e) => [e.family, e.points]).sort()).toEqual([['confs.tech', 1], ['lvcva', 2]])
  expect(s.evidence[0]).toHaveProperty('label')
})
test('familyOf groups copy sites and strips www', () => {
  expect(familyOf('raw.githubusercontent.com', c)).toBe('confs.tech')
  expect(familyOf('app.ticketmaster.com', c)).toBe('ticketmaster')
  expect(familyOf('www.lacclink.com', c)).toBe('lacclink.com')
  expect(familyOf('WWW.Example.org', c)).toBe('example.org')
})
test('loadCredibility rejects a malformed file', async () => {
  const { writeFileSync, mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const p = join(mkdtempSync(join(tmpdir(), 'cred-')), 'c.yaml')
  writeFileSync(p, 'points: {official-site: nope}\n')
  expect(() => loadCredibility(p)).toThrow(/credibility/i)
})
