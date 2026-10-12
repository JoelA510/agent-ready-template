import type { Meta, StoryObj } from '@storybook/react-vite'
import { Bold, Italic, Underline } from 'lucide-react'

import { ToggleGroup, ToggleGroupItem } from './toggle-group'

const meta = {
  title: 'Components/ToggleGroup',
  component: ToggleGroup,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A row of Toggle controls sharing one Radix ToggleGroup root, in either `type="single"` (exactly one item pressed, e.g. a view-density switch) or `type="multiple"` (any number pressed, e.g. text formatting) mode. Set `variant`/`size` on the ToggleGroup itself to style every item consistently without repeating the props — for a set of options where only one can ever be true and all should read as radio semantics, prefer RadioGroup instead.',
      },
    },
  },
} satisfies Meta<typeof ToggleGroup>

export default meta
type Story = StoryObj<typeof meta>

export const Single: Story = {
  name: 'Type: single',
  args: { type: 'single' },
  render: () => (
    <ToggleGroup type="single" defaultValue="comfortable" variant="outline" aria-label="View density">
      <ToggleGroupItem value="compact">Compact</ToggleGroupItem>
      <ToggleGroupItem value="comfortable">Comfortable</ToggleGroupItem>
      <ToggleGroupItem value="spacious">Spacious</ToggleGroupItem>
    </ToggleGroup>
  ),
}

export const Multiple: Story = {
  name: 'Type: multiple',
  args: { type: 'multiple' },
  render: () => (
    <ToggleGroup type="multiple" variant="outline" aria-label="Text formatting">
      <ToggleGroupItem value="bold" aria-label="Bold">
        <Bold />
      </ToggleGroupItem>
      <ToggleGroupItem value="italic" aria-label="Italic">
        <Italic />
      </ToggleGroupItem>
      <ToggleGroupItem value="underline" aria-label="Underline">
        <Underline />
      </ToggleGroupItem>
    </ToggleGroup>
  ),
}
