import { readFileSync } from 'node:fs'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

const raw = JSON.parse(readFileSync('src/test-data/seed-events.json', 'utf8'))
const today = new Date(2026, 10, 15)
const ok = () => Promise.resolve(raw)

function mockMedia(narrow: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: narrow, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
  })) as never
}
beforeEach(() => {
  window.history.replaceState(null, '', '/')
  mockMedia(false)
})

test('row click opens the drawer; Esc closes it', async () => {
  render(<App today={today} load={ok} />)
  await screen.findByRole('heading', { name: '24 conferences' })
  await userEvent.click(within(screen.getAllByTestId('event-row').find((r) => within(r).queryByText('CES 2027'))!).getByText('CES 2027'))
  expect(screen.getByRole('dialog', { name: 'CES 2027' })).toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).toBeNull()
})
test('calendar view persists in the URL and shows the first upcoming month', async () => {
  render(<App today={today} load={ok} />)
  await screen.findByRole('heading', { name: '24 conferences' })
  await userEvent.click(screen.getByRole('button', { name: 'Calendar' }))
  expect(window.location.search).toContain('view=calendar')
  expect(screen.getByRole('heading', { name: 'November 2026' })).toBeInTheDocument()
})
test('compare view opens and Back to results returns', async () => {
  render(<App today={today} load={ok} />)
  await screen.findByRole('heading', { name: '24 conferences' })
  await userEvent.click(screen.getByRole('button', { name: 'Compare cities' }))
  expect(screen.getByRole('heading', { name: 'Compare cities' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /Back to results/ }))
  expect(screen.getByRole('heading', { name: '24 conferences' })).toBeInTheDocument()
})
test('view param in the URL is honored on load', async () => {
  window.history.replaceState(null, '', '/?view=compare')
  render(<App today={today} load={ok} />)
  expect(await screen.findByRole('heading', { name: 'Compare cities' })).toBeInTheDocument()
})
test('mobile: no sidebar; Filters button shows count; sheet applies', async () => {
  mockMedia(true)
  window.history.replaceState(null, '', '/?states=Nevada')
  render(<App today={today} load={ok} />)
  await screen.findByRole('heading', { name: '12 conferences' })
  expect(screen.queryByRole('complementary', { name: 'Filters' })).toBeNull()
  const btn = screen.getByRole('button', { name: /Filters · 1/ })
  await userEvent.click(btn)
  const sheet = screen.getByRole('dialog', { name: 'Filters' })
  await userEvent.click(within(sheet).getByRole('checkbox', { name: /Nevada/ }))
  expect(within(sheet).getByRole('button', { name: 'Show 24 conferences' })).toBeInTheDocument()
  await userEvent.click(within(sheet).getByRole('button', { name: 'Show 24 conferences' }))
  expect(screen.queryByRole('dialog', { name: 'Filters' })).toBeNull()
  expect(screen.getByRole('heading', { name: '24 conferences' })).toBeInTheDocument()
})
test('mobile renders cards instead of a table', async () => {
  mockMedia(true)
  render(<App today={today} load={ok} />)
  await screen.findByRole('heading', { name: '24 conferences' })
  expect(screen.queryByRole('table')).toBeNull()
  expect(screen.getAllByTestId('event-card').length).toBe(24)
})
