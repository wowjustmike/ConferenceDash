import { useEffect, useMemo, useState } from 'react'
import { ActiveChips, PRESET_LABEL, activeFilterCount } from './components/ActiveChips'
import { CalendarView } from './components/CalendarView'
import { CompareView } from './components/CompareView'
import { EmptyState } from './components/EmptyState'
import { EventDrawer } from './components/EventDrawer'
import { FilterSidebar } from './components/FilterSidebar'
import { MapView } from './components/MapView'
import { MobileFilterSheet } from './components/MobileFilterSheet'
import { ResultCards } from './components/ResultCards'
import { ResultsList } from './components/ResultsList'
import { Skeleton } from './components/Skeleton'
import { TopBar } from './components/TopBar'
import { VIEWS, ViewToggle, type View } from './components/ViewToggle'
import { applyFilters, sortEvents, type Filters, type SortBy } from './lib/filters'
import { filtersToParams, paramsToFilters } from './lib/url'
import { useEvents, defaultLoad, type Loader } from './lib/useEvents'
import { useMedia } from './lib/useMedia'
import { useTheme } from './lib/theme'
import { isSample } from './lib/sample'
import type { ConfEvent } from './lib/schema'

interface Props { today?: Date; load?: Loader }

function initialView(): View {
  const v = new URLSearchParams(window.location.search).get('view') as View | null
  return v && VIEWS.includes(v) ? v : 'list'
}

export default function App({ today: todayProp, load = defaultLoad }: Props) {
  const today = useMemo(() => todayProp ?? new Date(), [todayProp])
  const { events, loading, error, retry } = useEvents(load)
  const { theme, toggle } = useTheme()
  const isMobile = useMedia('(max-width: 767px)')
  const [filters, setFilters] = useState<Filters>(() => paramsToFilters(new URLSearchParams(window.location.search)))
  const [view, setView] = useState<View>(initialView)
  const [sort, setSort] = useState<SortBy>('date')
  const [selected, setSelected] = useState<ConfEvent | null>(null)
  const [month, setMonth] = useState<Date | null>(null)
  const [sheet, setSheet] = useState(false)

  useEffect(() => {
    const p = filtersToParams(filters)
    if (view !== 'list') p.set('view', view)
    const qs = p.toString()
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
  }, [filters, view])

  const results = useMemo(() => sortEvents(applyFilters(events, filters, today), sort), [events, filters, today, sort])
  const calMonth = useMemo(() => {
    if (month) return month
    const first = results.length ? results.reduce((a, b) => (b.start_date < a.start_date ? b : a)).start_date : null
    return first ? new Date(+first.slice(0, 4), +first.slice(5, 7) - 1, 1) : new Date(today.getFullYear(), today.getMonth(), 1)
  }, [month, results, today])

  const sampleCount = useMemo(() => events.filter(isSample).length, [events])
  const count = results.length === 1 ? '1 conference' : `${results.length} conferences`
  const drawer = selected && <EventDrawer event={selected} events={events} today={today} onClose={() => setSelected(null)} onSelect={setSelected} />
  const sidebar = <FilterSidebar events={events} filters={filters} onChange={setFilters} today={today} />

  let body
  if (view === 'compare') {
    body = <CompareView events={events} today={today} onBack={() => setView('list')} />
  } else if (results.length === 0) {
    body = <EmptyState events={events} filters={filters} today={today} onChange={setFilters} />
  } else if (view === 'calendar') {
    body = <CalendarView events={results} month={calMonth} onMonthChange={setMonth} onSelect={setSelected} selectedId={selected?.id} />
  } else if (view === 'map') {
    body = <MapView events={results} onSelect={setSelected} />
  } else if (isMobile) {
    body = <ResultCards events={results} today={today} onSelect={setSelected} />
  } else {
    body = <ResultsList events={results} today={today} sort={sort} onSort={setSort} onSelect={setSelected} selectedId={selected?.id} />
  }

  return (
    <div className="app">
      <TopBar q={filters.q} onQ={(q) => setFilters({ ...filters, q })} theme={theme} onToggleTheme={toggle} />
      {loading ? (
        <main className="layout"><Skeleton /></main>
      ) : error ? (
        <main className="layout">
          <div className="empty" style={{ gridColumn: '1 / -1', margin: 24 }}>
            <div>
              <h3>Couldn’t load conferences</h3>
              <p className="muted">{error}</p>
              <button className="btn" onClick={retry}>Retry</button>
            </div>
          </div>
        </main>
      ) : (
        <div className="layout" style={view === 'compare' || isMobile ? { gridTemplateColumns: '1fr' } : undefined}>
          {!isMobile && view !== 'compare' && sidebar}
          <main className="main">
            {view !== 'compare' && (
              <>
                {isMobile && (
                  <div className="mobile-bar mobile-only">
                    <button className="btn primary" onClick={() => setSheet(true)}>
                      Filters{activeFilterCount(filters) > 0 ? ` · ${activeFilterCount(filters)}` : ''}
                    </button>
                    <ViewToggle view={view} onChange={setView} />
                  </div>
                )}
                <div className="main-head">
                  <div>
                    <h1>{count}</h1>
                    <p className="muted">
                      {[filters.states.join(' & '), PRESET_LABEL[filters.preset]].filter(Boolean).join(' · ')} · Listings re-checked daily
                    </p>
                  </div>
                  {!isMobile && (
                    <div className="view-tools">
                      <ViewToggle view={view} onChange={setView} />
                      <button className="btn compare-link" onClick={() => setView('compare')}>Compare cities</button>
                    </div>
                  )}
                </div>
                <ActiveChips filters={filters} onChange={setFilters} />
                {isMobile && <button className="link" style={{ marginBottom: 8 }} onClick={() => setView('compare')}>Compare cities</button>}
              </>
            )}
            {body}
            {view !== 'compare' && <p className="muted foot">Showing {results.length}{sampleCount > 0 && ` · Includes ${sampleCount} sample event${sampleCount === 1 ? '' : 's'} with placeholder data`}</p>}
          </main>
        </div>
      )}
      {drawer}
      {isMobile && sheet && (
        <MobileFilterSheet count={results.length} onClose={() => setSheet(false)} onChange={setFilters}>{sidebar}</MobileFilterSheet>
      )}
    </div>
  )
}
