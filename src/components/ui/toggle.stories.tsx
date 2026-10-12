import type { Meta, StoryObj } from '@storybook/react-vite'
import { Bold } from 'lucide-react'

import { Toggle } from './toggle'

const meta = {
  title: 'Components/Toggle',
  component: Toggle,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A single two-state pressed/unpressed control, built on Radix Toggle. Use a standalone Toggle for one independent on/off affordance inline with content (e.g. a formatting button or a "show billed hours only" filter) — for a set of related, mutually exclusive or multi-select options grouped together, use ToggleGroup instead so only one focus stop and one accessible group name are needed.',
      },
    },
  },
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'outline'],
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
    },
    disabled: { control: 'boolean' },
  },
  args: {
    children: 'Starred only',
    variant: 'default',
    size: 'md',
    disabled: false,
  },
} satisfies Meta<typeof Toggle>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Outline: Story = {
  args: { variant: 'outline' },
}

export const Disabled: Story = {
  args: { disabled: true },
}

export const Pressed: Story = {
  args: { defaultPressed: true },
}

export const IconOnly: Story = {
  name: 'Icon only',
  args: { variant: 'outline', 'aria-label': 'Bold' },
  render: (args) => (
    <Toggle {...args}>
      <Bold />
    </Toggle>
  ),
}
