import React from 'react'
import { readFileSync } from 'node:fs'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EventDrawer } from './EventDrawer'
import { parseEvents } from '../lib/schema'

const { events } = parseEvents(JSON.parse(readFileSync('src/test-data/seed-events.json', 'utf8')))
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

test('related lists exclude events that already ended', () => {
  const ended = { ...events.find((e) => e.id !== ces.id && e.venue === ces.venue)!, id: 'old', name: 'Old Show', start_date: '2026-10-10', end_date: '2026-10-12' }
  render(<EventDrawer event={ces} events={[...events, ended]} today={today} onClose={() => {}} onSelect={() => {}} />)
  expect(screen.queryByText('Old Show')).toBeNull()
})
test('focus moves into the drawer, is trapped, and returns to the trigger on close', async () => {
  const Host = () => {
    const [open, setOpen] = React.useState(false)
    return (<><button onClick={() => setOpen(true)}>trigger</button>{open && <EventDrawer event={ces} events={events} today={today} onClose={() => setOpen(false)} onSelect={() => {}} />}</>)
  }
  render(<Host />)
  const trigger = screen.getByRole('button', { name: 'trigger' })
  await userEvent.click(trigger)
  const dialog = screen.getByRole('dialog')
  expect(dialog.contains(document.activeElement)).toBe(true)
  for (let i = 0; i < 40; i++) await userEvent.tab()
  expect(dialog.contains(document.activeElement)).toBe(true)
  for (let i = 0; i < 40; i++) await userEvent.tab({ shift: true })
  expect(dialog.contains(document.activeElement)).toBe(true)
  await userEvent.keyboard('{Escape}')
  expect(trigger).toHaveFocus()
})
