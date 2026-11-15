import { render, screen } from '@testing-library/react'
import App from './App'

test('App renders ConferenceDash heading', () => {
  render(<App />)
  expect(screen.getByText('ConferenceDash')).toBeInTheDocument()
})
