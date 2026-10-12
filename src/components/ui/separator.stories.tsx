import type { Meta, StoryObj } from '@storybook/react-vite'

import { Separator } from './separator'

const meta = {
  title: 'Components/Separator',
  component: Separator,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A thin visual divider between grouped content, wrapping the Radix Separator primitive. Use the horizontal orientation to divide stacked blocks (e.g. sections within a card) and vertical to divide items in a row (e.g. inline labels in a toolbar). Decorative by default, so it is hidden from the accessibility tree — set `decorative={false}` only when the divider carries real semantic meaning for assistive tech.',
      },
    },
  },
  argTypes: {
    orientation: {
      control: 'select',
      options: ['horizontal', 'vertical'],
    },
  },
  args: {
    orientation: 'horizontal',
  },
} satisfies Meta<typeof Separator>

export default meta
type Story = StoryObj<typeof meta>

export const Horizontal: Story = {
  render: (args) => (
    <div className="w-80">
      <div className="space-y-1">
        <h4 className="text-sm font-medium text-foreground">Acme Inc.</h4>
        <p className="text-sm text-muted-foreground">Analytics and workflow tools for modern teams.</p>
      </div>
      <Separator {...args} className="my-4" />
      <div className="space-y-1">
        <h4 className="text-sm font-medium text-foreground">Contact</h4>
        <p className="text-sm text-muted-foreground">billing@acme.example</p>
      </div>
    </div>
  ),
}

export const Vertical: Story = {
  args: { orientation: 'vertical' },
  render: (args) => (
    <div className="flex h-5 items-center gap-4 text-sm text-muted-foreground">
      <span>Team</span>
      <Separator {...args} />
      <span>Project</span>
      <Separator {...args} />
      <span>Billing</span>
    </div>
  ),
}
