import { useCallback, useEffect, useState } from 'react'
import { parseEvents, type ConfEvent } from './schema'

export type Loader = () => Promise<unknown>

export const defaultLoad: Loader = async () => {
  // A self-contained page (e.g. the shared dashboard) embeds its data instead of fetching it.
  const embedded = (window as unknown as { __CONFERENCEDASH_EVENTS__?: unknown }).__CONFERENCEDASH_EVENTS__
  if (embedded !== undefined) return embedded
  const base = import.meta.env.BASE_URL
  const res = await fetch(`${base}events.json`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data: unknown = await res.json()
  // A large export is split into monthly shards listed in a manifest: { shards: ['events/2027-01.json', ...] }.
  if (data && typeof data === 'object' && !Array.isArray(data) && Array.isArray((data as { shards?: unknown }).shards)) {
    const parts = await Promise.all(
      ((data as { shards: string[] }).shards).map(async (s) => {
        const r = await fetch(`${base}${s}`)
        if (!r.ok) throw new Error(`HTTP ${r.status} loading ${s}`)
        const j: unknown = await r.json()
        return Array.isArray(j) ? j : []
      }),
    )
    return parts.flat()
  }
  return data
}

export function useEvents(load: Loader = defaultLoad) {
  const [events, setEvents] = useState<ConfEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    load()
      .then((raw) => {
        if (cancelled) return
        setEvents(parseEvents(raw).events)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Unknown error')
        setLoading(false)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  const retry = useCallback(() => setTick((t) => t + 1), [])
  return { events, loading, error, retry }
}
