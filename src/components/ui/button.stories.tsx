import type { Meta, StoryObj } from '@storybook/react-vite'
import { Mail, ArrowRight } from 'lucide-react'

import { Button } from './button'

const meta = {
  title: 'Components/Button',
  component: Button,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A Radix-Slot-backed button built with class-variance-authority. Use `primary` for the single main action on a screen; reach for `secondary`/`outline`/`ghost` for everything else, and `destructive` only for actions that delete or irreversibly change data. Pass `asChild` to render the styles on a different element (e.g. a router `<Link>`) instead of a `<button>`.',
      },
    },
  },
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'outline', 'ghost', 'link', 'destructive'],
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg', 'icon'],
    },
    disabled: { control: 'boolean' },
  },
  args: {
    children: 'Button',
    variant: 'primary',
    size: 'md',
    disabled: false,
  },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Primary: Story = {
  args: { variant: 'primary' },
}

export const Secondary: Story = {
  args: { variant: 'secondary' },
}

export const Outline: Story = {
  args: { variant: 'outline' },
}

export const Ghost: Story = {
  args: { variant: 'ghost' },
}

export const Link: Story = {
  args: { variant: 'link' },
}

export const Destructive: Story = {
  args: { variant: 'destructive', children: 'Delete project' },
}

export const Disabled: Story = {
  args: { disabled: true },
}

export const WithIcon: Story = {
  name: 'With icon',
  render: (args) => (
    <Button {...args}>
      <Mail /> Email customer
    </Button>
  ),
}

export const IconOnly: Story = {
  name: 'Icon only',
  args: { size: 'icon', variant: 'outline', 'aria-label': 'Next' },
  render: (args) => (
    <Button {...args}>
      <ArrowRight />
    </Button>
  ),
}

export const AllVariants: Story = {
  name: 'All variants',
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="link">Link</Button>
      <Button variant="destructive">Destructive</Button>
    </div>
  ),
}

export const AllSizes: Story = {
  name: 'All sizes',
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
      <Button size="icon" variant="outline" aria-label="Icon button">
        <ArrowRight />
      </Button>
    </div>
  ),
}
