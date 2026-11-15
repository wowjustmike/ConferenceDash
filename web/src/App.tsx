import { useEffect, useMemo, useState } from 'react'
import { ActiveChips } from './components/ActiveChips'
import { EmptyState } from './components/EmptyState'
import { FilterSidebar } from './components/FilterSidebar'
import { ResultsList } from './components/ResultsList'
import { Skeleton } from './components/Skeleton'
import { TopBar } from './components/TopBar'
import { applyFilters, sortEvents, type Filters, type SortBy } from './lib/filters'
import { filtersToParams, paramsToFilters } from './lib/url'
import { useEvents, defaultLoad, type Loader } from './lib/useEvents'
import { useTheme } from './lib/theme'
import { PRESET_LABEL } from './components/ActiveChips'

interface Props { today?: Date; load?: Loader }

export default function App({ today: todayProp, load = defaultLoad }: Props) {
  const today = useMemo(() => todayProp ?? new Date(), [todayProp])
  const { events, loading, error, retry } = useEvents(load)
  const { theme, toggle } = useTheme()
  const [filters, setFilters] = useState<Filters>(() => paramsToFilters(new URLSearchParams(window.location.search)))
  const [sort, setSort] = useState<SortBy>('date')

  useEffect(() => {
    const qs = filtersToParams(filters).toString()
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
  }, [filters])

  const results = useMemo(() => sortEvents(applyFilters(events, filters, today), sort), [events, filters, today, sort])

  return (
    <div className="app">
      <TopBar q={filters.q} onQ={(q) => setFilters({ ...filters, q })} theme={theme} onToggleTheme={toggle} />
      {loading ? (
        <main className="layout"><Skeleton /></main>
      ) : error ? (
        <main className="layout">
          <div className="empty">
            <div>
              <h3>Couldn’t load conferences</h3>
              <p className="muted">{error}</p>
              <button className="btn" onClick={retry}>Retry</button>
            </div>
          </div>
        </main>
      ) : (
        <div className="layout">
          <FilterSidebar events={events} filters={filters} onChange={setFilters} today={today} />
          <main className="main">
            <div className="main-head">
              <div>
                <h1>{results.length === 1 ? '1 conference' : `${results.length} conferences`}</h1>
                <p className="muted">
                  {[filters.states.join(' & '), PRESET_LABEL[filters.preset]].filter(Boolean).join(' · ')} · Listings re-checked daily
                </p>
              </div>
            </div>
            <ActiveChips filters={filters} onChange={setFilters} />
            {results.length === 0 ? (
              <EmptyState events={events} filters={filters} today={today} onChange={setFilters} />
            ) : (
              <ResultsList events={results} today={today} sort={sort} onSort={setSort} onSelect={() => {}} />
            )}
            <p className="muted foot">Showing {results.length} · Sample data for design review</p>
          </main>
        </div>
      )}
    </div>
  )
}
