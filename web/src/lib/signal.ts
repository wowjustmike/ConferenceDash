import type { ConfEvent, Signal } from './schema'

export type Bars = 1 | 2 | 3
const NONE: Signal = { points: 0, bars: 1, evidence: [], flags: [] }

/** Events without a computed signal count as a single unconfirmed source. */
export function signalFor(ev: Pick<ConfEvent, 'signal'>): Signal {
  return ev.signal ?? NONE
}

export const LEVEL_LABEL: Record<Bars, string> = { 3: 'Confirmed', 2: 'Likely', 1: 'Unconfirmed' }

export function signalTitle(bars: Bars, evidence: Signal['evidence'], flags: string[]): string {
  const head = bars === 3 ? 'Confirmed' : bars === 2 ? 'Likely: not yet confirmed on the organizer’s site' : 'Unconfirmed: a single source, not the organizer’s site'
  const lines = evidence.map((e) => `${e.label} (+${e.points})`)
  const notes = flags.map((f) => (f === 'conflicting-dates' ? 'Sources disagree on the dates' : f === 'stale' ? 'Not re-confirmed in 60+ days' : f))
  return [head, ...lines, ...notes].join('\n')
}
