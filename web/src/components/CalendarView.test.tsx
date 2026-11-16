import { readFileSync } from 'node:fs'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CalendarView } from './CalendarView'
import { parseEvents } from '../lib/schema'

const { events } = parseEvents(JSON.parse(readFileSync('src/test-data/seed-events.json', 'utf8')))

test('TBC events get the tbc class; confirmed do not', () => {
  render(<CalendarView events={events} month={new Date(2027, 2, 1)} onMonthChange={() => {}} onSelect={() => {}} />)
  expect(screen.getAllByTestId('cal-bar').find((b) => b.textContent?.includes('HIMSS27'))!).toHaveClass('tbc')
  expect(screen.getAllByTestId('cal-bar').find((b) => b.textContent?.includes('CERAWeek'))!).not.toHaveClass('tbc')
})
test('header shows month and count; navigation fires', async () => {
  const onMonthChange = vi.fn()
  render(<CalendarView events={events} month={new Date(2027, 2, 1)} onMonthChange={onMonthChange} onSelect={() => {}} />)
  expect(screen.getByRole('heading', { name: 'March 2027' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Next month' }))
  expect(onMonthChange).toHaveBeenCalledWith(new Date(2027, 3, 1))
  await userEvent.click(screen.getByRole('button', { name: 'Previous month' }))
  expect(onMonthChange).toHaveBeenCalledWith(new Date(2027, 1, 1))
})
test('agenda item click selects', async () => {
  const onSelect = vi.fn()
  render(<CalendarView events={events} month={new Date(2027, 2, 1)} onMonthChange={() => {}} onSelect={onSelect} />)
  await userEvent.click(screen.getAllByTestId('agenda-item').find((b) => b.textContent?.includes('SXSW EDU'))!)
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: 'SXSW EDU' }))
})
test('empty month renders without crashing', () => {
  render(<CalendarView events={events} month={new Date(2031, 0, 1)} onMonthChange={() => {}} onSelect={() => {}} />)
  expect(screen.getByText(/No conferences this month/)).toBeInTheDocument()
})
