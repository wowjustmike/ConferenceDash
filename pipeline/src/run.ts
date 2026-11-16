import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ConfEvent } from '../../web/src/lib/schema'
import { config } from './config'
import { findAmbiguous, mergeCandidates, pairKey, resolveAmbiguous } from './dedupe'
import { createAnthropicClient, LlmBudget, type LlmClient } from './extract/llm'
import { createFetcher } from './net/http'
import { mergeIntoExisting, reuseId, toConfEvent, writeEventsAtomic } from './publish'
import { dueForVerification, type Tier } from './schedule'
import { fetchConfsTech } from './sources/confsTech'
import { loadRegistry, runEntry, type RegistryEntry } from './sources/registry'
import { fetchTicketmaster } from './sources/ticketmaster'
import type { Candidate, RunReport, SourceHealth } from './types'
import { verifyOfficialSite, type Verification } from './verify'

export interface RunDeps {
  fetchText: (url: string) => Promise<string | null>
  fetchJson: (url: string) => Promise<unknown | null>
  llm: LlmClient
  budget: LlmBudget
  now: () => Date
  today: Date
  registry: RegistryEntry[]
  existing: ConfEvent[]
  confsYears: number[]
  confsTopics?: string[]
  tmKey: string | undefined
  tmVenues: { id: string; venue: string; city?: string; state?: string }[]
  writeEvents: (events: ConfEvent[]) => void
  writeOut: (name: string, data: unknown) => void
}

const usable = (h: SourceHealth) => h.ok && !h.error?.startsWith('skipped')

export async function runPipeline(args: { tier: Tier; dryRun: boolean; deps: RunDeps }): Promise<RunReport> {
  const { deps: d } = args
  const report: RunReport = {
    startedAt: d.now().toISOString(), sources: [], candidates: 0, merged: 0, verified: 0, published: 0, quarantined: 0, archived: 0, llmCalls: 0, errors: [], allSourcesFailed: false,
  }
  const candidates: Candidate[] = []
  const collect = async (id: string, fn: () => Promise<{ candidates: Candidate[]; health: SourceHealth }>) => {
    try {
      const r = await fn()
      candidates.push(...r.candidates)
      report.sources.push(r.health)
    } catch (e) {
      report.sources.push({ id, ok: false, count: 0, error: 'threw' })
      report.errors.push(`${id}: ${(e as Error).message}`)
    }
  }

  await collect('confs.tech', () => fetchConfsTech(d.fetchText, d.confsYears, d.confsTopics))
  await collect('ticketmaster', () => fetchTicketmaster(d.fetchJson, d.tmKey, d.tmVenues))
  for (const entry of d.registry) await collect(entry.id, () => runEntry(entry, { fetchText: d.fetchText, llm: d.llm, budget: d.budget, now: d.now }))
  report.candidates = candidates.length
  report.allSourcesFailed = !report.sources.some(usable)

  // Merge duplicates (adjudicating only the ambiguous pairs).
  const pairs = findAmbiguous(candidates)
  const verdicts = await resolveAmbiguous(d.llm, d.budget, pairs)
  const judged = new Map(pairs.map((p, i) => [pairKey(p[0], p[1]), verdicts[i]]))
  const todayIso = `${d.today.getFullYear()}-${String(d.today.getMonth() + 1).padStart(2, '0')}-${String(d.today.getDate()).padStart(2, '0')}`
  // Already-ended events are of no use to an upcoming-events directory; existing ones are archived by the merge step.
  const merged = mergeCandidates(candidates, judged).filter((m) => !m.candidate.end_date || m.candidate.end_date >= todayIso)
  report.merged = merged.length

  // Verify on the organizer's site: new events always, existing ones when due for this tier.
  const known = new Set(d.existing.map((e) => e.id))
  const fresh: ConfEvent[] = []
  const incomplete: unknown[] = []
  for (const m of merged) {
    const id = reuseId(m.candidate, d.existing)
    const prelim = toConfEvent(m, undefined, d.today, id)
    if (!prelim) { incomplete.push(m.candidate); continue }
    let v: Verification | undefined
    if (!known.has(prelim.id) || dueForVerification(prelim, d.today, args.tier)) {
      try {
        v = await verifyOfficialSite(d.fetchText, d.llm, d.budget, { name: prelim.name, official_url: prelim.official_url, start_date: prelim.start_date, end_date: prelim.end_date, city: prelim.city })
        if (v.reachable) report.verified++
      } catch (e) {
        report.errors.push(`verify ${prelim.id}: ${(e as Error).message}`)
      }
    }
    const final = toConfEvent(m, v, d.today, id)
    if (final) fresh.push(final)
  }

  const result = mergeIntoExisting(d.existing, fresh, { today: d.today, healthy: !report.allSourcesFailed, dropSeed: report.sources.filter((x) => usable(x) && x.count > 0).length >= 3 ? 'all' : 'matched' })
  report.published = fresh.filter((f) => f.confidence >= config.publishThreshold).length
  report.quarantined = result.quarantined.length
  report.archived = result.archived
  report.llmCalls = d.budget.used

  if (!args.dryRun && !report.allSourcesFailed) d.writeEvents(result.events)
  d.writeOut('report.json', report)
  d.writeOut('quarantine.json', { quarantined: result.quarantined, incomplete })
  return report
}

function parseArgs(argv: string[]): { tier: Tier; dryRun: boolean } {
  const i = argv.indexOf('--tier')
  const tier = (i >= 0 ? argv[i + 1] : 'daily') as Tier
  if (!['daily', 'weekly', 'monthly'].includes(tier)) throw new Error(`Unknown --tier ${tier}`)
  return { tier, dryRun: argv.includes('--dry-run') }
}

async function main() {
  const { tier, dryRun } = parseArgs(process.argv.slice(2))
  const fetcher = createFetcher({ userAgent: config.userAgent, cacheDir: join(config.outDir, '../.cache') })
  const key = process.env.ANTHROPIC_API_KEY
  const llm: LlmClient = key ? createAnthropicClient(key) : { extract: async () => { throw new Error('ANTHROPIC_API_KEY not set') } }
  if (!key) console.warn('ANTHROPIC_API_KEY not set: LLM extraction and verification fallbacks are disabled.')
  const read = <T,>(p: string, dflt: T): T => { try { return JSON.parse(readFileSync(p, 'utf8')) as T } catch { return dflt } }
  const here = new URL('.', import.meta.url).pathname
  const now = new Date()
  const report = await runPipeline({
    tier, dryRun,
    deps: {
      fetchText: fetcher.fetchText, llm, budget: new LlmBudget(config.maxLlmCalls), now: () => new Date(), today: now,
      fetchJson: async (u) => { const t = await fetcher.fetchText(u); try { return t ? JSON.parse(t) : null } catch { return null } },
      registry: loadRegistry(join(here, '../sources/registry.yaml')), existing: read<ConfEvent[]>(config.eventsPath, []),
      confsYears: [now.getFullYear(), now.getFullYear() + 1], tmKey: process.env.TICKETMASTER_KEY,
      tmVenues: read(join(here, '../sources/ticketmaster-venues.json'), []),
      writeEvents: (events) => writeEventsAtomic(config.eventsPath, events),
      writeOut: (name, data) => { mkdirSync(config.outDir, { recursive: true }); writeFileSync(join(config.outDir, name), JSON.stringify(data, null, 2)) },
    },
  })
  console.log(JSON.stringify(report, null, 2))
  if (report.allSourcesFailed) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
