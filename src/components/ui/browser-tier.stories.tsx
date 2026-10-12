import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { Button } from './button'

// A canary for the browser tier (npm run test:browser), not a component: it proves the stories
// render with the design system's CSS. Without it (a config that turns CSS off, a broken
// globals.css import), every story still renders, but unstyled: axe then measures black on white
// and browser-default sizes, and the contrast and target-size checks pass for nothing.
// Hidden from the sidebar and docs; still run as a test.
// Which theme this pass renders (vitest.browser.config.ts); absent outside the browser tier.
declare const __STORYBOOK_THEME__: string | undefined

const meta = {
  title: 'Internal/Browser tier canary',
  component: Button,
  tags: ['!dev', '!autodocs'],
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const DesignSystemCssIsApplied: Story = {
  args: { children: 'Save changes' },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Save changes' })
    const root = getComputedStyle(document.documentElement)
    // The generated token CSS defines the semantic roles on :root.
    await expect(root.getPropertyValue('--primary').trim()).not.toBe('')
    // Tailwind's bg-primary resolved to the token, not the browser's default button face.
    const background = getComputedStyle(button).backgroundColor
    await expect(['', 'rgba(0, 0, 0, 0)', 'rgb(239, 239, 239)', 'rgb(240, 240, 240)']).not.toContain(background)
    // Layout exists: the default button is h-9 (36px), which a jsdom or unstyled render isn't.
    await expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(32)
    // The pass renders in the theme it says it does, so the dark pass really checks dark.
    const theme = typeof __STORYBOOK_THEME__ === 'string' ? __STORYBOOK_THEME__ : 'light'
    await expect(document.documentElement.classList.contains('dark')).toBe(theme === 'dark')
  },
}
