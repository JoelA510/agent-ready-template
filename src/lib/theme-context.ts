import { createContext, useContext } from 'react'

export type Theme = 'light' | 'dark'

export interface ThemeContextValue {
  /** The active theme. Mirrors the `dark` class on `<html>`. */
  theme: Theme
  /** Set the theme explicitly. */
  setTheme: (theme: Theme) => void
  /** Flip between light and dark. */
  toggleTheme: () => void
}

// null when read outside a ThemeProvider — useTheme() turns that into a clear error
// instead of silently handing back a default that doesn't reflect the real DOM state.
export const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (context === null) {
    throw new Error('useTheme must be used within a <ThemeProvider>')
  }
  return context
}
