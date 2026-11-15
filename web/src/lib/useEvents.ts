import { useCallback, useEffect, useState } from 'react'
import { parseEvents, type ConfEvent } from './schema'

export type Loader = () => Promise<unknown>

export const defaultLoad: Loader = async () => {
  const res = await fetch(`${import.meta.env.BASE_URL}events.json`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
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
