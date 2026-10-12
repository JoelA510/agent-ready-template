import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { ThemeContext, type Theme } from '@/lib/theme-context'

const STORAGE_KEY = 'theme'

// Storage is a hostile dependency: it throws in Safari private mode, is absent in sandboxed
// iframes, and can be shadowed by a non-functional global in some JS runtimes. Persistence is a
// convenience here, never a correctness requirement — so every access degrades to a no-op
// rather than taking the whole tree down with it.
function readStoredTheme(): string | null {
  try {
    const storage = window.localStorage
    return typeof storage?.getItem === 'function' ? storage.getItem(STORAGE_KEY) : null
  } catch {
    return null
  }
}

function writeStoredTheme(theme: Theme): void {
  try {
    const storage = window.localStorage
    if (typeof storage?.setItem === 'function') storage.setItem(STORAGE_KEY, theme)
  } catch {
    // Quota exceeded or storage denied — the theme still applies for this session.
  }
}

// Runs once, lazily, to decide the starting theme: an explicit prior choice wins, otherwise
// fall back to the OS preference. Guards `window` so it's safe if ever rendered on a server.
function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  const stored = readStoredTheme()
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * Opt-in runtime theme switcher. Wrap your app in it to get a live light/dark toggle that
 * persists the choice and respects the OS preference on first load. It is intentionally NOT
 * mounted by default — the tokens work without it; this only adds the runtime switch.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    const root = window.document.documentElement
    root.classList.toggle('dark', theme === 'dark')
    writeStoredTheme(theme)
  }, [theme])

  const setTheme = useCallback((next: Theme) => setThemeState(next), [])
  const toggleTheme = useCallback(
    () => setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark')),
    [],
  )

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
