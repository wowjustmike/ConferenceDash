import { readFileSync } from 'node:fs'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CompareView } from './CompareView'
import { parseEvents } from '../lib/schema'

const { events } = parseEvents(JSON.parse(readFileSync('../data/events.json', 'utf8')))
const today = new Date(2026, 10, 15)

test('defaults to top three cities and shows the glance table', () => {
  render(<CompareView events={events} today={today} />)
  const table = screen.getByRole('table', { name: 'At a glance' })
  expect(within(table).getByText('Las Vegas')).toBeInTheDocument()
  expect(within(table).getAllByRole('row')).toHaveLength(4) // header + 3
})
test('a fourth city is rejected with a message; removing one allows the swap', async () => {
  render(<CompareView events={events} today={today} />)
  const picker = screen.getByTestId('city-picker')
  await userEvent.click(within(picker).getByRole('button', { name: /Austin/ }))
  expect(screen.getByText(/Three cities max/)).toBeInTheDocument()
  expect(within(picker).getByRole('button', { name: /Austin/ })).toHaveAttribute('aria-pressed', 'false')
  await userEvent.click(within(picker).getByRole('button', { name: /Chicago/ }))
  await userEvent.click(within(picker).getByRole('button', { name: /Austin/ }))
  expect(within(picker).getByRole('button', { name: /Austin/ })).toHaveAttribute('aria-pressed', 'true')
})
test('topic filter changes counts', async () => {
  render(<CompareView events={events} today={today} />)
  await userEvent.click(screen.getByRole('button', { name: 'Healthcare' }))
  const table = screen.getByRole('table', { name: 'At a glance' })
  const lvRow = within(table).getByText('Las Vegas').closest('tr')!
  expect(within(lvRow).getAllByRole('cell')[1]).toHaveTextContent('1')
})
