import { resolve } from 'node:path'

export interface Config {
  publishThreshold: number
  maxLlmCalls: number
  extractModel: string
  adjudicateModel: string
  userAgent: string
  eventsPath: string
  outDir: string
}

const num = (v: string | undefined, d: number) => {
  const n = Number(v)
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : d
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    publishThreshold: num(env.PUBLISH_THRESHOLD, 0.6),
    maxLlmCalls: num(env.MAX_LLM_CALLS, 300),
    extractModel: env.EXTRACT_MODEL || 'claude-haiku-5-5',
    adjudicateModel: env.ADJUDICATE_MODEL || 'claude-sonnet-5-5',
    userAgent: 'ConferenceDashBot/1.0',
    eventsPath: resolve(import.meta.dirname, '../../data/events.json'),
    outDir: resolve(import.meta.dirname, '../out'),
  }
}

export const config = loadConfig()
