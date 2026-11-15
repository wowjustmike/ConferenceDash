import { parseLocalDate } from './dates'
import type { ConfEvent } from './schema'

export interface Segment { event: ConfEvent; startCol: number; endCol: number; lane: number; continuesLeft: boolean; continuesRight: boolean }
export interface WeekRow { days: Date[]; segments: Segment[]; lanes: number }

/** Sunday-first week rows covering `month0` of `year`; events are clipped into per-week bar segments. */
export function weekRows(events: ConfEvent[], year: number, month0: number): WeekRow[] {
  const first = new Date(year, month0, 1)
  const last = new Date(year, month0 + 1, 0)
  const gridStart = new Date(year, month0, 1 - first.getDay())
  const weeks = Math.ceil((first.getDay() + last.getDate()) / 7)
  const rows: WeekRow[] = []
  for (let w = 0; w < weeks; w++) {
    const days = Array.from({ length: 7 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + w * 7 + i))
    const ws = days[0]
    const we = days[6]
    const segs: Omit<Segment, 'lane'>[] = []
    for (const event of events) {
      const s = parseLocalDate(event.start_date)
      const e = parseLocalDate(event.end_date)
      if (s > we || e < ws) continue
      const startCol = s < ws ? 0 : s.getDay()
      const endCol = e > we ? 6 : e.getDay()
      segs.push({ event, startCol, endCol, continuesLeft: s < ws, continuesRight: e > we })
    }
    segs.sort((a, b) => a.startCol - b.startCol || b.endCol - a.endCol || a.event.name.localeCompare(b.event.name))
    const laneEnds: number[] = []
    const segments: Segment[] = segs.map((s) => {
      let lane = laneEnds.findIndex((end) => end < s.startCol)
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(s.endCol) } else laneEnds[lane] = s.endCol
      return { ...s, lane }
    })
    rows.push({ days, segments, lanes: laneEnds.length })
  }
  return rows
}
