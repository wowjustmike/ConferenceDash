import { resolve } from 'node:path'

export interface Config {
  publishThreshold: number
  maxLlmCalls: number
  extractModel: string
  adjudicateModel: string
  userAgent: string
  eventsPath: string
  outDir: string
  dataDir: string
  dbPath: string
  windowStart: string
  windowEnd: string
  sampleDropThreshold: number
  maxExportBytes: number
}

const num = (v: string | undefined, d: number) => {
  const n = Number(v)
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : d
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    publishThreshold: num(env.PUBLISH_THRESHOLD, 0.3),
    maxLlmCalls: num(env.MAX_LLM_CALLS, 300),
    extractModel: env.EXTRACT_MODEL || 'claude-haiku-5-5',
    adjudicateModel: env.ADJUDICATE_MODEL || 'claude-sonnet-5-5',
    userAgent: 'ConferenceDashBot/1.0',
    eventsPath: resolve(import.meta.dirname, '../../data/events.json'),
    outDir: resolve(import.meta.dirname, '../out'),
    dataDir: resolve(import.meta.dirname, '../../data'),
    dbPath: env.DB_PATH || resolve(import.meta.dirname, '../../data/conferencedash.db'),
    windowStart: env.WINDOW_START || '2026-11-15',
    windowEnd: env.WINDOW_END || '2027-12-31',
    sampleDropThreshold: num(env.SAMPLE_DROP_THRESHOLD, 100),
    maxExportBytes: num(env.MAX_EXPORT_BYTES, 5 * 1024 * 1024),
  }
}

export const config = loadConfig()
