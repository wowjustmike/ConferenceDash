import type { Theme } from '../lib/theme'

interface Props { q: string; onQ: (q: string) => void; theme: Theme; onToggleTheme: () => void; onSubmit?: () => void }

export function TopBar({ q, onQ, theme, onToggleTheme, onSubmit }: Props) {
  return (
    <header className="topbar">
      <div className="brand"><span className="logo" aria-hidden>≡</span>ConferenceDash</div>
      <input
        className="search" type="search" value={q} placeholder="Search conferences, venues, organizers"
        aria-label="Search conferences" onChange={(e) => onQ(e.target.value)}
      />
      <a className="btn" href="mailto:?subject=ConferenceDash%20event%20submission" onClick={onSubmit}><span>+ Submit<span className="long"> your event</span></span></a>
      <button className="btn icon" onClick={onToggleTheme} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
        {theme === 'dark' ? '☀' : '☾'}
      </button>
    </header>
  )
}
