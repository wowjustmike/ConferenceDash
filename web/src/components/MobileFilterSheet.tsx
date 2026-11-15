import { useEffect, useRef, type ReactNode } from 'react'
import { useDialogFocus } from '../lib/useDialogFocus'
import { EMPTY_FILTERS, type Filters } from '../lib/filters'

interface Props { count: number; onClose: () => void; onChange: (f: Filters) => void; children: ReactNode }

export function MobileFilterSheet({ count, onClose, onChange, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useDialogFocus(ref)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <>
      <div className="sheet-scrim" onClick={onClose} />
      <div ref={ref} className="sheet" role="dialog" aria-modal="true" aria-label="Filters">
        <div className="side-head" style={{ padding: '14px 18px 0' }}>
          <h2>Filters</h2>
          <span><button className="link" onClick={() => onChange(EMPTY_FILTERS)}>Clear all</button> <button className="btn icon" aria-label="Close" onClick={onClose}>×</button></span>
        </div>
        <div className="sheet-body">{children}</div>
        <div className="sheet-foot">
          <button className="btn primary" onClick={onClose}>Show {count === 1 ? '1 conference' : `${count} conferences`}</button>
        </div>
      </div>
    </>
  )
}
