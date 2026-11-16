import type { Verification } from './verify'

export interface ScoreInput { verification?: Verification; agreeingSources: number; hasOfficialUrl: boolean; conflictingDates: boolean; ageDays: number }

const clamp = (n: number) => Math.min(1, Math.max(0, n))

export function confidence(i: ScoreInput): number {
  const v = i.verification
  if (v?.cancelled) return 0.2
  let s: number
  if (v?.reachable && v.datesConfirmed) s = 0.9
  else if (v?.reachable && v.editionYearSeen && v.cityMatches) s = 0.65
  else if (i.agreeingSources >= 2) s = 0.65
  else if (i.hasOfficialUrl) s = 0.5
  else s = 0.35
  if (i.agreeingSources >= 3) s += 0.05
  if (i.conflictingDates) s -= 0.2
  if (i.ageDays > 180) s -= 0.2
  else if (i.ageDays > 90) s -= 0.1
  // Without an organizer URL nothing can be verified, so aggregator-only data never reaches the publish threshold.
  if (!i.hasOfficialUrl) s = Math.min(s, 0.5)
  return clamp(s)
}
