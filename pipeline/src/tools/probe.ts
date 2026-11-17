import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { config } from '../config'
import { createBrowserFetcher, type BrowserFetcher } from '../net/browser'
import { createFetcher } from '../net/http'
import { entryYaml, probeUrl, type ProbeMeta, type ProbeResult } from '../probe'
import { EntrySchema, loadRegistry } from '../sources/registry'

export interface ListTarget extends ProbeMeta { url: string }

/** `url | city | state | venue` per line; `#` comments and blank lines are skipped. */
export function parseListFile(text: string): ListTarget[] {
  const out: ListTarget[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const [url, city, state, venue] = line.split('|').map((s) => s.trim())
    const t: ListTarget = { url }
    if (city) t.city = city
    if (state) t.state = state
    if (venue) t.venue = venue
    out.push(t)
  }
  return out
}

/** Appends one entry to registry.yaml when its id is new and the schema accepts it; the file is restored if the result fails to load. */
export function addToRegistry(registryPath: string, entry: Record<string, unknown>): { added: boolean; reason?: 'exists' | 'invalid' } {
  if (loadRegistry(registryPath).some((e) => e.id === entry.id)) return { added: false, reason: 'exists' }
  if (!EntrySchema.safeParse(entry).success) return { added: false, reason: 'invalid' }
  const original = readFileSync(registryPath, 'utf8')
  writeFileSync(registryPath, original.replace(/\n*$/, '\n') + entryYaml(entry))
  try { loadRegistry(registryPath) } catch { writeFileSync(registryPath, original); return { added: false, reason: 'invalid' } }
  return { added: true }
}

export const reportPath = (outDir: string, host: string) => join(outDir, 'probes', `${host}.json`)

export function formatTable(results: ProbeResult[]): string {
  const rows = [['url', 'verdict', 'kind', 'count'], ...results.map((r) => [r.url, r.verdict, r.detection?.kind ?? '-', String(r.count)])]
  const width = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)))
  return rows.map((r) => r.map((c, i) => c.padEnd(width[i])).join('  ').trimEnd()).join('\n')
}

function report(r: ProbeResult): string {
  const lines = [`${r.url}`, `  verdict: ${r.verdict}${r.note ? ` (${r.note})` : ''}`]
  if (r.detection) lines.push(`  kind: ${r.detection.kind}  evidence: ${r.detection.evidence}  browser: ${r.usedBrowser ? 'yes' : 'no'}`)
  lines.push(`  upcoming: ${r.count}  rejected: ${r.rejected}`)
  for (const s of r.sample) lines.push(`    ${s.start_date ?? '????-??-??'}..${s.end_date ?? '????-??-??'}  ${s.name}  ${s.official_url ?? ''}`)
  if (r.entry) lines.push('  registry entry:', entryYaml(r.entry).replace(/^/gm, '  '))
  return lines.join('\n')
}

// npm run probe -- <url> [--city C] [--state ST] [--venue V] [--id X] [--add]
// npm run probe -- --list <file> [--add is ignored in list mode]
async function main() {
  const a = process.argv.slice(2)
  const opt = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined }
  const list = opt('--list')
  const url = a[0] && !a[0].startsWith('--') ? a[0] : undefined
  if (!list && !url) throw new Error('usage: npm run probe -- <url> [--city C] [--state ST] [--venue V] [--id X] [--add] | --list <file>')
  const fetcher = createFetcher({ userAgent: config.userAgent, cacheDir: join(config.outDir, '../.cache') })
  let browser: BrowserFetcher | undefined
  const deps = {
    canFetch: fetcher.canFetch, fetchText: fetcher.fetchText, lastStatus: fetcher.lastStatus, now: () => new Date(),
    get browser() { return (browser ??= createBrowserFetcher({ userAgent: config.userAgent, canFetch: fetcher.canFetch })) },
  }
  const registryPath = join(new URL('.', import.meta.url).pathname, '../../sources/registry.yaml')
  const targets: ListTarget[] = list ? parseListFile(readFileSync(list, 'utf8')) : [{ url: url!, city: opt('--city'), state: opt('--state'), venue: opt('--venue'), id: opt('--id') }]
  const results: ProbeResult[] = []
  try {
    for (const t of targets) {
      const { url: u, ...meta } = t
      const r = await probeUrl(u, deps, meta)
      results.push(r)
      mkdirSync(join(config.outDir, 'probes'), { recursive: true })
      writeFileSync(reportPath(config.outDir, r.host), JSON.stringify(r, null, 2))
      console.log(report(r))
    }
  } finally {
    await browser?.close()
  }
  if (list) {
    console.log('\n' + formatTable(results))
    if (a.includes('--add')) console.log('\n--add is ignored in --list mode: review each sample, then add sites one at a time.')
    return
  }
  const r = results[0]
  if (a.includes('--add')) {
    if (r.verdict !== 'ok' || r.count < 3 || !r.entry) console.log(`\nNot added: verdict ${r.verdict}, ${r.count} upcoming events (need ok and at least 3).`)
    else { const res = addToRegistry(registryPath, r.entry); console.log(res.added ? `\nAdded ${r.entry.id} to sources/registry.yaml` : `\nNot added: ${res.reason}`) }
  }
  if (r.verdict !== 'ok') process.exit(2)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
