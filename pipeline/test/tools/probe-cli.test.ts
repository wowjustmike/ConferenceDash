import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadRegistry } from '../../src/sources/registry'
import { addToRegistry, formatTable, parseListFile, reportPath } from '../../src/tools/probe'
import type { ProbeResult } from '../../src/probe'

test('parseListFile reads url and optional columns, skips comments and blank lines', () => {
  expect(parseListFile('# rejected\nhttps://a.example/ | Denver | CO | Colorado CC\n\nhttps://b.example/\n  # indented comment\nhttps://c.example/ | Boston | MA\n')).toEqual([
    { url: 'https://a.example/', city: 'Denver', state: 'CO', venue: 'Colorado CC' }, { url: 'https://b.example/' }, { url: 'https://c.example/', city: 'Boston', state: 'MA' },
  ])
})
test('addToRegistry appends a valid entry once and refuses a duplicate id', () => {
  const p = join(mkdtempSync(join(tmpdir(), 'reg-')), 'registry.yaml')
  writeFileSync(p, 'sources:\n  - id: a\n    kind: page\n    type: html\n    url: https://a.example/\n')
  expect(addToRegistry(p, { id: 'b', kind: 'cards', type: 'html', url: 'https://b.example/', item: '.c', title: '.t', date: '.d' })).toEqual({ added: true })
  expect(loadRegistry(p).map((e) => e.id)).toEqual(['a', 'b'])
  expect(addToRegistry(p, { id: 'b', kind: 'page', type: 'html', url: 'https://b.example/' })).toEqual({ added: false, reason: 'exists' })
  expect(loadRegistry(p)).toHaveLength(2)
})
test('addToRegistry refuses an entry the registry schema rejects, leaving the file untouched', () => {
  const p = join(mkdtempSync(join(tmpdir(), 'reg-')), 'registry.yaml')
  writeFileSync(p, 'sources:\n  - id: a\n    kind: page\n    type: html\n    url: https://a.example/\n')
  expect(addToRegistry(p, { id: 'b', kind: 'cards', type: 'html', url: 'https://b.example/' })).toEqual({ added: false, reason: 'invalid' })
  expect(loadRegistry(p)).toHaveLength(1)
})
test('reportPath is per host under out/probes', () => {
  expect(reportPath('/tmp/out', 'www.x.example')).toBe('/tmp/out/probes/www.x.example.json')
})
test('formatTable prints a header and one row per result', () => {
  const r = (o: Partial<ProbeResult>): ProbeResult => ({ url: 'https://x.example/', host: 'x.example', verdict: 'ok', detection: null, usedBrowser: false, count: 0, sample: [], rejected: 0, entry: null, ...o })
  const lines = formatTable([r({ count: 12, detection: { kind: 'cards', count: 12, evidence: '', needsBrowser: false } }), r({ url: 'https://y.example/', verdict: 'blocked: robots.txt' })]).split('\n')
  expect(lines).toHaveLength(3)
  expect(lines[1]).toMatch(/https:\/\/x\.example\/.*ok.*cards.*12/)
  expect(lines[2]).toMatch(/blocked: robots\.txt/)
})
