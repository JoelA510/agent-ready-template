import type { Meta, StoryObj } from '@storybook/react-vite'

import { Label } from './label'
import { Input } from './input'

const meta = {
  title: 'Components/Label',
  component: Label,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'An accessible label for a form control, built on Radix `Label.Root`. Pair its `htmlFor` with the control\'s `id` so clicking the label focuses the control, and use the `peer` utility on the control (e.g. `peer` on `Input`, `peer-disabled:` here) so the label dims automatically when that control is disabled.',
      },
    },
  },
  args: {
    children: 'Label text',
  },
} satisfies Meta<typeof Label>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { children: 'Project name' },
}

export const WithControl: Story = {
  name: 'With control',
  render: () => (
    <div className="grid gap-1.5">
      <Label htmlFor="story-project-name">Project name</Label>
      <Input id="story-project-name" placeholder="Website redesign — Globex" />
    </div>
  ),
}
