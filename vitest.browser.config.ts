import { defineConfig, type TestProjectInlineConfiguration } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { playwright } from '@vitest/browser-playwright'
import { existsSync } from 'node:fs'
import path from 'node:path'

// The browser tier (npm run test:browser), kept out of vitest.config.ts so `npm run test` and
// `npm run check` never load Storybook or need a browser. Every story runs in real Chromium with
// the a11y addon's axe check after it renders, where layout exists: color contrast as rendered and
// WCAG 2.2 target size, which jsdom can't measure. Twice: once per theme.
//
// Chromium comes from `npx playwright install chromium`. A sandbox that ships its own points
// PLAYWRIGHT_CHROMIUM_EXECUTABLE at it instead of downloading one (tooling config, not app env).
const chromium = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined
if (chromium && !existsSync(chromium)) {
  throw new Error(`PLAYWRIGHT_CHROMIUM_EXECUTABLE is "${chromium}", which doesn't exist.`)
}

const stories = (theme: 'light' | 'dark'): TestProjectInlineConfiguration => ({
  extends: true,
  // Tailwind as the app builds it (vite.config.ts), which Vitest doesn't read. Without it the
  // stories render with no utility classes, so axe measures browser-default sizes and colors and
  // every contrast and target-size check means nothing. The canary story
  // (browser-tier.stories.tsx) fails if that ever happens again.
  plugins: [tailwindcss(), storybookTest({ configDir: path.join(import.meta.dirname, '.storybook') })],
  // Read by .storybook/preview.tsx's initialGlobals, so each pass renders in its theme.
  define: { __STORYBOOK_THEME__: JSON.stringify(theme) },
  test: {
    name: `stories-${theme}`,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({ launchOptions: { executablePath: chromium } }),
      instances: [{ browser: 'chromium' }],
    },
  },
})

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    projects: [stories('light'), stories('dark')],
  },
})
