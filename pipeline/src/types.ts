import type { Topic } from '../../web/src/lib/schema'

export type SourceType = 'confs.tech' | 'ical' | 'jsonld' | 'html' | 'llm' | 'claude-venue-calendar' | 'claude-directory' | 'claude-aggregator' | 'claude-organizer' | 'api' | 'aggregator' | 'seed' | 'submission'
export interface SourceRef { url: string; type: SourceType; fetched_at: string }

export interface Candidate {
  name: string
  start_date?: string
  end_date?: string
  city?: string
  state?: string
  venue?: string
  organizer?: string
  topics?: Topic[]
  est_attendance?: number | null
  official_url?: string
  source: SourceRef
}

export interface SourceHealth { id: string; ok: boolean; count: number; error?: string }

export interface RunReport {
  startedAt: string
  sources: SourceHealth[]
  candidates: number
  merged: number
  verified: number
  published: number
  quarantined: number
  archived: number
  llmCalls: number
  errors: string[]
  allSourcesFailed: boolean
}
