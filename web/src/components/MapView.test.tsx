import { readFileSync } from 'node:fs'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MapView } from './MapView'
import { parseEvents } from '../lib/schema'

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  Marker: ({ eventHandlers, children, position }: { eventHandlers?: { click?: () => void }; children?: React.ReactNode; position: [number, number] }) => (
    <button data-testid="pin" data-pos={position.join(',')} onClick={() => eventHandlers?.click?.()}>{children}</button>
  ),
}))

const { events } = parseEvents(JSON.parse(readFileSync('../data/events.json', 'utf8')))

test('one pin per metro; selecting Las Vegas shows its events and attendee total', async () => {
  render(<MapView events={events} onSelect={() => {}} />)
  expect(screen.getAllByTestId('pin')).toHaveLength(6)
  const panel = screen.getByTestId('map-panel')
  expect(within(panel).getByText('Las Vegas')).toBeInTheDocument()
  expect(within(panel).getByTestId('kpi-count')).toHaveTextContent('12')
  expect(within(panel).getByTestId('kpi-attendees')).toHaveTextContent('477K')
})
test('clicking another pin switches the panel; null attendance ignored in total', async () => {
  render(<MapView events={events} onSelect={() => {}} />)
  const pins = screen.getAllByTestId('pin')
  const austin = pins.find((p) => p.dataset.pos!.startsWith('30.27'))!
  await userEvent.click(austin)
  const panel = screen.getByTestId('map-panel')
  expect(within(panel).getByText('Austin')).toBeInTheDocument()
  expect(within(panel).getByTestId('kpi-attendees')).toHaveTextContent('—')
})
test('unmapped city is counted, not thrown', () => {
  const odd = { ...events[0], id: 'odd', city: 'Nowhere', state: 'Nevada' }
  render(<MapView events={[...events, odd]} onSelect={() => {}} />)
  expect(screen.getByText(/1 unmapped/)).toBeInTheDocument()
})
test('empty events renders a message', () => {
  render(<MapView events={[]} onSelect={() => {}} />)
  expect(screen.getByText(/No conferences to map/)).toBeInTheDocument()
})
