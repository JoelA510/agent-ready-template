import { Moon, Sun } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useTheme } from '@/lib/theme-context'

/**
 * A ready-made light/dark switch built on the design system's own Button. Must be rendered
 * inside a <ThemeProvider>. Use it as-is, or as a reference for wiring your own control to
 * `useTheme()`.
 */
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {isDark ? <Sun /> : <Moon />}
      {isDark ? 'Light' : 'Dark'}
    </Button>
  )
}
