import type { Meta, StoryObj } from '@storybook/react-vite'

import { Checkbox } from './checkbox'
import { Label } from './label'

const meta = {
  title: 'Components/Checkbox',
  component: Checkbox,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A Radix-backed checkbox for a single boolean choice or one option within a list of independent toggles. Reach for Switch instead when the choice takes effect immediately (like an on/off setting) rather than as part of a form that gets submitted.',
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
} satisfies Meta<typeof Checkbox>

export default meta
type Story = StoryObj<typeof meta>

export const Unchecked: Story = {
  args: { 'aria-label': 'Unchecked checkbox' },
}

export const Checked: Story = {
  args: { defaultChecked: true, 'aria-label': 'Checked checkbox' },
}

export const Disabled: Story = {
  args: { disabled: true, 'aria-label': 'Disabled checkbox' },
}

export const DisabledChecked: Story = {
  name: 'Disabled checked',
  args: { disabled: true, defaultChecked: true, 'aria-label': 'Disabled checked checkbox' },
}

export const WithLabel: Story = {
  name: 'With label',
  render: () => (
    <div className="flex items-center gap-2">
      <Checkbox id="marketing-emails" defaultChecked />
      <Label htmlFor="marketing-emails">Send me billing summary emails</Label>
    </div>
  ),
}
