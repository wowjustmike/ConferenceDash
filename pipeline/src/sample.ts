import type { ConfEvent } from '../../web/src/lib/schema'

/** Placeholder events carry only `seed` sources. */
export const isSampleEvent = (e: Pick<ConfEvent, 'sources'>): boolean => e.sources.length > 0 && e.sources.every((s) => s.type === 'seed')
