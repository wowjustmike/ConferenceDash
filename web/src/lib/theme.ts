import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

function read(): Theme {
  try { return localStorage.getItem('theme') === 'dark' ? 'dark' : 'light' } catch { return 'light' }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(read)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('theme', theme) } catch { /* storage unavailable */ }
  }, [theme])
  return { theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) }
}
