import type { Meta, StoryObj } from '@storybook/react-vite'

import { Switch } from './switch'
import { Label } from './label'

const meta = {
  title: 'Components/Switch',
  component: Switch,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A Radix-backed on/off toggle for settings that take effect immediately. Reach for Checkbox instead when the choice is part of a form that gets submitted later, or when presenting several independent options in a list.',
      },
    },
  },
  argTypes: {
    disabled: { control: 'boolean' },
    checked: { control: 'boolean' },
  },
  args: {
    disabled: false,
  },
} satisfies Meta<typeof Switch>

export default meta
type Story = StoryObj<typeof meta>

export const Unchecked: Story = {
  args: { 'aria-label': 'Unchecked switch' },
}

export const Checked: Story = {
  args: { defaultChecked: true, 'aria-label': 'Checked switch' },
}

export const Disabled: Story = {
  args: { disabled: true, 'aria-label': 'Disabled switch' },
}

export const DisabledChecked: Story = {
  name: 'Disabled checked',
  args: { disabled: true, defaultChecked: true, 'aria-label': 'Disabled checked switch' },
}

export const WithLabel: Story = {
  name: 'With label',
  render: () => (
    <div className="flex items-center gap-2">
      <Switch id="auto-billing" defaultChecked />
      <Label htmlFor="auto-billing">Automatically send billing summaries</Label>
    </div>
  ),
}
