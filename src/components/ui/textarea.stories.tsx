import type { Meta, StoryObj } from '@storybook/react-vite'

import { Textarea } from './textarea'
import { Label } from './label'

const meta = {
  title: 'Components/Textarea',
  component: Textarea,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A multi-line text field for longer free-form content — project notes, billing memos, meeting summaries. Shares the same border, focus, disabled, and `aria-invalid` styling as `Input`; reach for `Input` instead when the value is a single line.',
      },
    },
  },
  argTypes: {
    placeholder: { control: 'text' },
    disabled: { control: 'boolean' },
  },
  args: {
    placeholder: 'Add notes about this project…',
    disabled: false,
  },
} satisfies Meta<typeof Textarea>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {},
}

export const Disabled: Story = {
  args: { disabled: true, placeholder: 'Cannot edit' },
}

export const Invalid: Story = {
  args: { 'aria-invalid': true, placeholder: 'Required field', defaultValue: '' },
}

export const WithLabel: Story = {
  name: 'With label',
  render: () => (
    <div className="grid gap-1.5">
      <Label htmlFor="story-project-notes">Project notes</Label>
      <Textarea id="story-project-notes" placeholder="Add notes about this project…" />
    </div>
  ),
}
