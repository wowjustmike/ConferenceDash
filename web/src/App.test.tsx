import { readFileSync } from 'node:fs'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

const raw = JSON.parse(readFileSync('src/test-data/seed-events.json', 'utf8'))
const today = new Date(2026, 10, 15)
const ok = () => Promise.resolve(raw)

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  document.documentElement.removeAttribute('data-theme')
  try { localStorage.clear() } catch { /* ignore */ }
})

test('shows skeleton while loading', () => {
  render(<App today={today} load={() => new Promise(() => {})} />)
  expect(screen.getByTestId('skeleton')).toBeInTheDocument()
})

test('fetch failure shows error with Retry', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(raw)
  render(<App today={today} load={load} />)
  expect(await screen.findByText(/couldn.t load conferences/i)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByRole('heading', { name: '24 conferences' })).toBeInTheDocument()
  expect(load).toHaveBeenCalledTimes(2)
})

test('ticking Nevada narrows results, shows a chip, chip removal restores', async () => {
  render(<App today={today} load={ok} />)
  await screen.findByRole('heading', { name: '24 conferences' })
  await userEvent.click(screen.getByRole('checkbox', { name: /Nevada/ }))
  expect(screen.getByRole('heading', { name: '12 conferences' })).toBeInTheDocument()
  const chips = screen.getByTestId('active-chips')
  await userEvent.click(within(chips).getByRole('button', { name: /Remove Nevada/ }))
  expect(screen.getByRole('heading', { name: '24 conferences' })).toBeInTheDocument()
})

test('city list only shows cities of selected states, with counts', async () => {
  render(<App today={today} load={ok} />)
  await screen.findByRole('heading', { name: '24 conferences' })
  await userEvent.click(screen.getByRole('checkbox', { name: /Nevada/ }))
  const city = screen.getByTestId('facet-city')
  expect(within(city).getByRole('checkbox', { name: /Las Vegas/ })).toBeInTheDocument()
  expect(within(city).queryByRole('checkbox', { name: /Austin/ })).toBeNull()
  expect(within(city).getByText('12')).toBeInTheDocument()
})

test('Clear all resets filters', async () => {
  render(<App today={today} load={ok} />)
  await screen.findByRole('heading', { name: '24 conferences' })
  await userEvent.click(screen.getByRole('checkbox', { name: /Nevada/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Clear all' }))
  expect(screen.getByRole('heading', { name: '24 conferences' })).toBeInTheDocument()
})

test('sorting by name reorders rows', async () => {
  render(<App today={today} load={ok} />)
  await screen.findByRole('heading', { name: '24 conferences' })
  await userEvent.click(screen.getByRole('button', { name: 'Name' }))
  const rows = screen.getAllByTestId('event-row')
  expect(within(rows[0]).getByText('Adobe Summit')).toBeInTheDocument()
})

test('rows show badges and a safe official-site link', async () => {
  render(<App today={today} load={ok} />)
  await screen.findByRole('heading', { name: '24 conferences' })
  const rows = screen.getAllByTestId('event-row')
  const ces = rows.find((r) => within(r).queryByText('CES 2027'))!
  expect(within(ces).getByText(/Today|0d ago/)).toBeInTheDocument()
  const link = within(ces).getByRole('link', { name: /Official site/ })
  expect(link).toHaveAttribute('target', '_blank')
  expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  const himss = rows.find((r) => within(r).queryByText('HIMSS27 Global Conference'))!
  expect(within(himss).getByText('Dates TBC')).toBeInTheDocument()
})

test('Show all states expands the list', async () => {
  render(<App today={today} load={ok} />)
  await screen.findByRole('heading', { name: '24 conferences' })
  expect(screen.queryByRole('checkbox', { name: /Texas/ })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: /Show all 5 states/ }))
  expect(screen.getByRole('checkbox', { name: /Texas/ })).toBeInTheDocument()
})

test('zero results shows empty state with suggestions and Clear all', async () => {
  render(<App today={today} load={ok} />)
  await screen.findByRole('heading', { name: '24 conferences' })
  await userEvent.type(screen.getByPlaceholderText(/Search conferences/), 'zzzz')
  expect(await screen.findByText('No conferences match these filters')).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: 'Clear all' }).length).toBeGreaterThan(0)
  expect(screen.getAllByTestId('suggestion').length).toBeGreaterThan(0)
})

test('theme toggle sets data-theme and persists', async () => {
  render(<App today={today} load={ok} />)
  await screen.findByRole('heading', { name: '24 conferences' })
  await userEvent.click(screen.getByRole('button', { name: /dark mode/i }))
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(localStorage.getItem('theme')).toBe('dark')
})

test('sample data notice is visible', async () => {
  render(<App today={today} load={ok} />)
  await waitFor(() => expect(screen.getAllByText(/sample events/i).length).toBeGreaterThan(0))
})

test('mixed data: only sample rows are tagged and the footer counts them; real-only data has no notice', async () => {
  const real = { ...raw[0], id: 'real-1', name: 'Real Conf', sources: [{ url: 'https://x.example', type: 'confs.tech', fetched_at: '2026-11-01T00:00:00Z' }] }
  const { unmount } = render(<App today={today} load={() => Promise.resolve([real, ...raw])} />)
  await screen.findByRole('heading', { name: '25 conferences' })
  const rows = screen.getAllByTestId('event-row')
  const realRow = rows.find((r) => within(r).queryByText('Real Conf'))!
  expect(within(realRow).queryByText('Sample')).toBeNull()
  expect(within(rows.find((r) => within(r).queryByText('CES 2027'))!).getByText('Sample')).toBeInTheDocument()
  expect(screen.getByText(/Includes 24 sample events/)).toBeInTheDocument()
  unmount()
  render(<App today={today} load={() => Promise.resolve([real])} />)
  await screen.findByRole('heading', { name: '1 conference' })
  expect(screen.queryByText(/sample/i)).toBeNull()
})

const signal3 = { points: 3, bars: 3, flags: [], evidence: [{ label: 'Confirmed on the official site (ces.tech)', family: 'ces.tech', kind: 'official-site', points: 3, seenAt: '2026-11-10' }] }
const withSignal = () => [{ ...raw[0], id: 'sig3', name: 'Sig Three', signal: signal3 }, ...raw]

test('rows show signal bars (1 by default, 3 when the data says so)', async () => {
  render(<App today={today} load={() => Promise.resolve(withSignal())} />)
  await screen.findByRole('heading', { name: '25 conferences' })
  const rows = screen.getAllByTestId('event-row')
  const row = rows.find((r) => within(r).queryByText('Sig Three'))!
  expect(within(row).getByRole('img', { name: /Signal strength 3 of 3/ })).toBeInTheDocument()
  expect(within(rows.find((r) => within(r).queryByText('CES 2027'))!).getByRole('img', { name: /Signal strength 1 of 3/ })).toBeInTheDocument()
})
test('"Confirmed" signal filter keeps only 3-bar events and shows a chip', async () => {
  render(<App today={today} load={() => Promise.resolve(withSignal())} />)
  await screen.findByRole('heading', { name: '25 conferences' })
  await userEvent.click(screen.getByRole('button', { name: /Confirmed \(3 bars\)/ }))
  expect(screen.getByRole('heading', { name: '1 conference' })).toBeInTheDocument()
  expect(window.location.search).toContain('signal=3')
  await userEvent.click(within(screen.getByTestId('active-chips')).getByRole('button', { name: /Remove Signal 3\+ bars/ }))
  expect(screen.getByRole('heading', { name: '25 conferences' })).toBeInTheDocument()
})
test('sorting by signal puts the strongest first', async () => {
  render(<App today={today} load={() => Promise.resolve(withSignal())} />)
  await screen.findByRole('heading', { name: '25 conferences' })
  await userEvent.click(screen.getByRole('button', { name: 'Signal' }))
  expect(within(screen.getAllByTestId('event-row')[0]).getByText('Sig Three')).toBeInTheDocument()
})
test('the drawer explains the evidence behind the bars', async () => {
  render(<App today={today} load={() => Promise.resolve(withSignal())} />)
  await screen.findByRole('heading', { name: '25 conferences' })
  await userEvent.click(within(screen.getAllByTestId('event-row').find((r) => within(r).queryByText('Sig Three'))!).getByText('Sig Three'))
  const dlg = screen.getByRole('dialog', { name: 'Sig Three' })
  expect(within(dlg).getByText('Confirmed on the official site (ces.tech)')).toBeInTheDocument()
  expect(within(dlg).getByText('+3')).toBeInTheDocument()
})
