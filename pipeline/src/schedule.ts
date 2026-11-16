import type { ConfEvent } from '../../web/src/lib/schema'

export type Tier = 'daily' | 'weekly' | 'monthly'

const day = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).getTime() }
const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

export function dueForVerification(ev: ConfEvent, today: Date, tier: Tier): boolean {
  if (ev.status !== 'active') return false
  const t = midnight(today)
  if (day(ev.end_date) < t) return false
  const days = Math.round((day(ev.start_date) - t) / 864e5)
  if (days <= 30) return true
  if (days <= 180) return tier !== 'daily'
  return tier === 'monthly'
}
