import type { Meta, StoryObj } from '@storybook/react-vite'

import { ThemeProvider } from './theme-provider'
import { ThemeToggle } from './theme-toggle'

const meta = {
  title: 'Components/Theme Toggle',
  component: ThemeToggle,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A light/dark switch built on the system Button and wired to `useTheme()`. It toggles the `dark` class on `<html>`, persists the choice to `localStorage`, and honors `prefers-color-scheme` on first load. Must be rendered inside a `<ThemeProvider>` — applied here via a decorator. Note this drives the real document theme, so it interacts with the Storybook theme switcher in the toolbar.',
      },
    },
  },
  decorators: [
    (Story) => (
      <ThemeProvider>
        <Story />
      </ThemeProvider>
    ),
  ],
} satisfies Meta<typeof ThemeToggle>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
