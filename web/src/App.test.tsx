import { readFileSync } from 'node:fs'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

const raw = JSON.parse(readFileSync('../data/events.json', 'utf8'))
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
  await waitFor(() => expect(screen.getAllByText(/Sample data/).length).toBeGreaterThan(0))
})
