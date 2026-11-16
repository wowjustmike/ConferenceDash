import { renderHook, act } from '@testing-library/react'
import { useTheme } from './theme'

const mockScheme = (dark: boolean) => {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({ matches: dark && q.includes('dark'), media: q, addEventListener: () => {}, removeEventListener: () => {} })) as never
}
beforeEach(() => { try { localStorage.clear() } catch { /* ignore */ } document.documentElement.removeAttribute('data-theme') })

test('first visit follows the system color scheme', () => {
  mockScheme(true)
  renderHook(() => useTheme())
  expect(document.documentElement.dataset.theme).toBe('dark')
})
test('a stored choice beats the system setting, and toggling persists', () => {
  mockScheme(true)
  localStorage.setItem('theme', 'light')
  const { result } = renderHook(() => useTheme())
  expect(document.documentElement.dataset.theme).toBe('light')
  act(() => result.current.toggle())
  expect(localStorage.getItem('theme')).toBe('dark')
})
test('without matchMedia the default is light', () => {
  ;(window as unknown as { matchMedia?: unknown }).matchMedia = undefined
  renderHook(() => useTheme())
  expect(document.documentElement.dataset.theme).toBe('light')
})
