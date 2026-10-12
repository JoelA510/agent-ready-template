import type { Meta, StoryObj } from '@storybook/react-vite'

import { Badge } from './badge'

const meta = {
  title: 'Components/Badge',
  component: Badge,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A small inline pill for status or category labels — project status, billing state, tags on a customer record. Not interactive by default; pass `asChild` to render the pill styles on another element (e.g. a router `<Link>`) when the badge itself should act as a link. Prefer the semantic variants (`success`, `warning`, `destructive`, `info`) over `default`/`secondary` whenever the badge is communicating a state rather than just a neutral label.',
      },
    },
  },
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'secondary', 'outline', 'success', 'warning', 'destructive', 'info'],
    },
  },
  args: {
    children: 'Badge',
    variant: 'default',
  },
} satisfies Meta<typeof Badge>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { variant: 'default' },
}

export const Secondary: Story = {
  args: { variant: 'secondary', children: 'Draft' },
}

export const Outline: Story = {
  args: { variant: 'outline', children: 'Archived' },
}

export const Success: Story = {
  args: { variant: 'success', children: 'Active' },
}

export const Warning: Story = {
  args: { variant: 'warning', children: 'Needs review' },
}

export const Destructive: Story = {
  args: { variant: 'destructive', children: 'Overdue' },
}

export const Info: Story = {
  args: { variant: 'info', children: 'In progress' },
}

export const AllVariants: Story = {
  name: 'All variants',
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Badge variant="default">Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="outline">Outline</Badge>
      <Badge variant="success">Active</Badge>
      <Badge variant="warning">Needs review</Badge>
      <Badge variant="destructive">Overdue</Badge>
      <Badge variant="info">In progress</Badge>
    </div>
  ),
}
