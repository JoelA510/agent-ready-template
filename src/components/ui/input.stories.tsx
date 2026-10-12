import type { Meta, StoryObj } from '@storybook/react-vite'

import { Input } from './input'
import { Label } from './label'

const meta = {
  title: 'Components/Input',
  component: Input,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A single-line text field for short-form data entry — names, emails, order numbers. Pair it with `Label` for a proper accessible name rather than relying on `placeholder` alone, and set `aria-invalid` (typically alongside a validation message) to flag a field that failed validation. For multi-line input, reach for `Textarea` instead.',
      },
    },
  },
  argTypes: {
    type: {
      control: 'select',
      options: ['text', 'email', 'password', 'number', 'file'],
    },
    placeholder: { control: 'text' },
    disabled: { control: 'boolean' },
  },
  args: {
    type: 'text',
    placeholder: 'Enter a value',
    disabled: false,
  },
} satisfies Meta<typeof Input>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { placeholder: 'Jane Cooper' },
}

export const WithPlaceholder: Story = {
  name: 'With placeholder',
  args: { placeholder: 'name@example.com' },
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
      <Label htmlFor="story-customer-name">Customer name</Label>
      <Input id="story-customer-name" placeholder="Jane Cooper" />
    </div>
  ),
}
