import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { config } from './config'
import { openDb, type Db } from './db/db'
import { unexclude } from './db/store'
import { ingestBatch } from './ingest'
import { listInbox, markInbox } from './inbox'
import { buildExport, planShards, recomputeSignals, writeExport } from './exporter'
import { createAnthropicClient, LlmBudget, type LlmClient } from './extract/llm'
import { createFetcher } from './net/http'
import { createBrowserFetcher } from './net/browser'
import { runPipeline, type RunDeps } from './run'
import type { Tier } from './schedule'
import { loadRegistry } from './sources/registry'
import type { ConfEvent } from '../../web/src/lib/schema'
import type { RunReport } from './types'

export interface ExportOpts { windowStart: string; windowEnd: string; sampleDropThreshold: number; maxBytes: number }
export interface Summary { report?: RunReport; exported: number; byBars: Record<1 | 2 | 3, number>; signalsChanged: number; failed?: boolean }

export async function runExport(a: { db: Db; exportDir: string; today: Date; exportOpts: ExportOpts }): Promise<Summary> {
  const signalsChanged = recomputeSignals(a.db, a.today)
  const events = buildExport(a.db, { windowStart: a.exportOpts.windowStart, windowEnd: a.exportOpts.windowEnd, sampleDropThreshold: a.exportOpts.sampleDropThreshold, today: a.today })
  writeExport(a.exportDir, planShards(events, a.exportOpts.maxBytes))
  const byBars: Summary['byBars'] = { 1: 0, 2: 0, 3: 0 }
  for (const e of events) byBars[e.signal.bars]++
  return { exported: events.length, byBars, signalsChanged }
}

export async function runUpdate(a: {
  db: Db; exportDir: string; tier: Tier; dryRun: boolean; deps: Omit<RunDeps, 'db'>; today: Date; exportOpts: ExportOpts
}): Promise<Summary> {
  const report = await runPipeline({ tier: a.tier, dryRun: a.dryRun, deps: { ...a.deps, db: a.db } })
  if (report.errors.some((e) => e.startsWith('save:'))) {
    // The database was rolled back; exporting now would only republish old state as if the run had succeeded.
    return { report, exported: 0, byBars: { 1: 0, 2: 0, 3: 0 }, signalsChanged: 0, failed: true }
  }
  if (a.dryRun || report.allSourcesFailed) {
    const empty = { 1: 0, 2: 0, 3: 0 } as Summary['byBars']
    return { report, exported: 0, byBars: empty, signalsChanged: 0 }
  }
  return { report, ...(await runExport({ db: a.db, exportDir: a.exportDir, today: a.today, exportOpts: a.exportOpts })) }
}

/** Reads the previous export: a plain array, or a shard manifest ({ shards: [...] }); never throws. */
export function readExistingExport(path: string): ConfEvent[] {
  try {
    const data: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (Array.isArray(data)) return data as ConfEvent[]
    const shards = (data as { shards?: unknown } | null)?.shards
    if (!Array.isArray(shards)) return []
    const out: ConfEvent[] = []
    for (const s of shards) {
      try { const j: unknown = JSON.parse(readFileSync(join(dirname(path), String(s)), 'utf8')); if (Array.isArray(j)) out.push(...(j as ConfEvent[])) } catch { /* skip a missing shard */ }
    }
    return out
  } catch {
    return []
  }
}

/** Loads KEY=VALUE lines from a .env file into the environment (values are never printed). */
function loadDotEnv(path: string): void {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

async function main() {
  const argv = process.argv.slice(2)
  loadDotEnv(join(config.dataDir, '../.env'))
  if (argv[0] === 'inbox') {
    const db = openDb(config.dbPath)
    if (argv[1] === 'done' || argv[1] === 'skip') { markInbox(db, Number(argv[2]), argv[1] === 'done' ? 'done' : 'skipped', argv.slice(3).join(' ') || undefined); return }
    for (const i of listInbox(db, argv[1] ?? 'pending')) console.log(`#${i.id} [${i.status}] ${i.url}\n    ${i.path}${i.notes ? `  (${i.notes})` : ''}`)
    return
  }
  if (argv[0] === 'ingest') {
    const file = argv[1]
    if (!file) throw new Error('usage: npm run ingest -- <batch.json>')
    const db = openDb(config.dbPath)
    const r = ingestBatch(db, JSON.parse(readFileSync(file, 'utf8')), { window: { start: config.windowStart, end: config.windowEnd }, today: new Date() })
    console.log(JSON.stringify(r, null, 2))
    return
  }
  if (argv[0] === 'unexclude') {
    const key = argv[1]
    if (!key) throw new Error('usage: npm run unexclude -- <event-key>')
    const ok = unexclude(openDb(config.dbPath), key)
    console.log(ok ? `Released ${key}. Run: npm run export` : `No exclusion found for ${key}`)
    return
  }
  const i = argv.indexOf('--tier')
  const tier = (i >= 0 ? argv[i + 1] : 'daily') as Tier
  if (!['daily', 'weekly', 'monthly'].includes(tier)) throw new Error(`Unknown --tier ${tier}`)
  const exportOpts: ExportOpts = { windowStart: config.windowStart, windowEnd: config.windowEnd, sampleDropThreshold: config.sampleDropThreshold, maxBytes: config.maxExportBytes }
  const db = openDb(config.dbPath)
  const today = new Date()
  if (argv[0] === 'export') {
    console.log(JSON.stringify(await runExport({ db, exportDir: config.dataDir, today, exportOpts }), null, 2))
    return
  }
  const fetcher = createFetcher({ userAgent: config.userAgent, cacheDir: join(config.outDir, '../.cache') })
  const key = process.env.ANTHROPIC_API_KEY
  const llm: LlmClient = key ? createAnthropicClient(key) : { extract: async () => { throw new Error('no AI key configured') } }
  const read = <T,>(p: string, dflt: T): T => { try { return JSON.parse(readFileSync(p, 'utf8')) as T } catch { return dflt } }
  const here = new URL('.', import.meta.url).pathname
  const existing = readExistingExport(config.eventsPath)
  const registry = loadRegistry(join(here, '../sources/registry.yaml'))
  const browser = registry.some((e) => e.kind === 'simpleview' || e.kind === 'datatable') ? createBrowserFetcher({ userAgent: config.userAgent, canFetch: fetcher.canFetch }) : undefined
  const summary = await runUpdate({
    db, exportDir: config.dataDir, tier, dryRun: argv.includes('--dry-run'), today, exportOpts,
    deps: {
      fetchText: fetcher.fetchText, llm, budget: new LlmBudget(config.maxLlmCalls), now: () => new Date(), today,
      fetchJson: async (u) => { const t = await fetcher.fetchText(u); try { return t ? JSON.parse(t) : null } catch { return null } },
      registry, existing, browser,
      confsYears: [today.getFullYear(), today.getFullYear() + 1], tmKey: process.env.TICKETMASTER_KEY,
      tmVenues: read(join(here, '../sources/ticketmaster-venues.json'), []),
      writeOut: (name, data) => { mkdirSync(config.outDir, { recursive: true }); writeFileSync(join(config.outDir, name), JSON.stringify(data, null, 2)) },
    },
  })
  await browser?.close()
  console.log(JSON.stringify(summary, null, 2))
  if (summary.report?.allSourcesFailed || summary.failed) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
