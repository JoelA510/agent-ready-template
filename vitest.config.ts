import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// https://vitest.dev/config/
//
// Two projects, because they need different environments: component tests render into jsdom
// with the browser shims in vitest.setup.ts; script tests exercise the Node tooling under
// scripts/ (spawning it against throwaway fixture trees) and must not load those shims.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    globals: true,
    css: false,
    projects: [
      {
        extends: true,
        test: {
          name: 'components',
          environment: 'jsdom',
          setupFiles: ['./vitest.setup.ts'],
          include: ['src/**/*.{test,spec}.{ts,tsx}'],
        },
      },
      {
        extends: true,
        test: {
          name: 'scripts',
          environment: 'node',
          include: ['scripts/**/*.test.ts'],
        },
      },
    ],
  },
})
