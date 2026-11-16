import { render, screen } from '@testing-library/react'
import { SignalBars } from './SignalBars'

const evidence = [
  { label: 'Confirmed on the official site (ces.tech)', family: 'ces.tech', kind: 'official-site', points: 3, seenAt: '2026-11-10' },
  { label: 'Directory listing (confs.tech)', family: 'confs.tech', kind: 'directory', points: 1, seenAt: '2026-11-01' },
]

test.each([1, 2, 3] as const)('exposes an accessible label and fills %i bars', (bars) => {
  const { container, unmount } = render(<SignalBars bars={bars} />)
  expect(screen.getByRole('img', { name: new RegExp(`Signal strength ${bars} of 3`) })).toBeInTheDocument()
  expect(container.querySelectorAll('rect.on')).toHaveLength(bars)
  expect(container.querySelectorAll('rect')).toHaveLength(3)
  unmount()
})
test('tooltip lists the evidence, and flags are called out', () => {
  const { container } = render(<SignalBars bars={2} evidence={evidence} flags={['stale']} />)
  const title = container.querySelector('title')!.textContent!
  expect(title).toContain('Confirmed on the official site (ces.tech)')
  expect(title).toContain('Directory listing (confs.tech)')
  expect(title).toMatch(/not re-?confirmed/i)
})
test('without evidence the tooltip still explains the level', () => {
  const { container } = render(<SignalBars bars={1} />)
  expect(container.querySelector('title')!.textContent).toMatch(/unconfirmed|single source/i)
})
