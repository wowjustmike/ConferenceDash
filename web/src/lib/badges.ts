import { daysUntil } from './dates'
import type { ConfEvent } from './schema'

export interface Badges { verified: 'fresh' | 'stale' | 'due'; tbc: boolean; ageDays: number }

export function badgesFor(ev: Pick<ConfEvent, 'last_verified' | 'dates_confirmed'>, today: Date): Badges {
  const ageDays = -daysUntil(ev.last_verified, today)
  return {
    verified: ageDays <= 30 ? 'fresh' : ageDays > 60 ? 'due' : 'stale',
    tbc: !ev.dates_confirmed,
    ageDays,
  }
}
