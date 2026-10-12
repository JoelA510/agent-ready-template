import type { Meta, StoryObj } from '@storybook/react-vite'

import { Card, CardContent, CardHeader } from './card'
import { Skeleton } from './skeleton'

const meta = {
  title: 'Components/Skeleton',
  component: Skeleton,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A pulsing placeholder block that stands in for content while it loads. Size it entirely through `className` (e.g. `h-4 w-48` for a text line, `size-9 rounded-full` for an avatar) — there are no variants to configure. Reach for Skeleton when a layout is loading for an unknown or unbounded duration; when you have a real, known completion percentage to show (a file upload, a multi-step wizard), use Progress instead.',
      },
    },
  },
} satisfies Meta<typeof Skeleton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => <Skeleton className="h-4 w-48" />,
}

export const AvatarSkeleton: Story = {
  name: 'Avatar skeleton',
  render: () => <Skeleton className="size-9 rounded-full" />,
}

export const CardSkeleton: Story = {
  name: 'Card skeleton',
  parameters: {
    docs: {
      description: {
        story:
          'A composed loading state for a project summary card — an avatar, a title line, and a couple of body lines, matching the real Card layout it will be replaced by once data arrives.',
      },
    },
  },
  render: () => (
    <Card className="w-80">
      <CardHeader>
        <div className="flex items-center gap-3">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </CardContent>
    </Card>
  ),
}
