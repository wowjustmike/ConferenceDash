import type { ConfEvent } from './schema'

/** Placeholder events carry only `seed` sources; anything backed by a real source is not sample data. */
export function isSample(ev: Pick<ConfEvent, 'sources'>): boolean {
  return ev.sources.length > 0 && ev.sources.every((s) => s.type === 'seed')
}
