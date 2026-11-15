import { readFileSync } from 'node:fs'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EventDrawer } from './EventDrawer'
import { parseEvents } from '../lib/schema'

const { events } = parseEvents(JSON.parse(readFileSync('../data/events.json', 'utf8')))
const today = new Date(2026, 10, 15)
const ces = events.find((e) => e.name === 'CES 2027')!

test('shows facts and related lists, excluding itself', () => {
  render(<EventDrawer event={ces} events={events} today={today} onClose={() => {}} onSelect={() => {}} />)
  expect(screen.getByRole('dialog', { name: 'CES 2027' })).toBeInTheDocument()
  expect(screen.getByText('Jan 6-9, 2027')).toBeInTheDocument()
  const venue = screen.getByTestId('related-venue')
  expect(within(venue).getByText('MJBizCon')).toBeInTheDocument()
  expect(within(venue).queryByText('CES 2027')).toBeNull()
  expect(screen.getByText('No other events from this organizer in the next 12 months.')).toBeInTheDocument()
})
test('Esc and × close', async () => {
  const onClose = vi.fn()
  render(<EventDrawer event={ces} events={events} today={today} onClose={onClose} onSelect={() => {}} />)
  await userEvent.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalledTimes(1)
  await userEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(onClose).toHaveBeenCalledTimes(2)
})
test('clicking a related event selects it', async () => {
  const onSelect = vi.fn()
  render(<EventDrawer event={ces} events={events} today={today} onClose={() => {}} onSelect={onSelect} />)
  await userEvent.click(screen.getByRole('button', { name: /MJBizCon/ }))
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: 'MJBizCon' }))
})
