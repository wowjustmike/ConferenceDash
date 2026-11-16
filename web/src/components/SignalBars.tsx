import { LEVEL_LABEL, signalTitle, type Bars } from '../lib/signal'
import type { Signal } from '../lib/schema'

interface Props { bars: Bars; evidence?: Signal['evidence']; flags?: string[]; size?: number }

const HEIGHTS = [6, 10, 14]

export function SignalBars({ bars, evidence = [], flags = [], size = 1 }: Props) {
  const title = signalTitle(bars, evidence, flags)
  return (
    <svg className="signal" width={18 * size} height={14 * size} viewBox="0 0 18 14" role="img" aria-label={`Signal strength ${bars} of 3: ${LEVEL_LABEL[bars]}`}>
      <title>{title}</title>
      {HEIGHTS.map((h, i) => (
        <rect key={i} className={i < bars ? 'on' : 'off'} x={i * 6} y={14 - h} width={4} height={h} rx={1} />
      ))}
    </svg>
  )
}
