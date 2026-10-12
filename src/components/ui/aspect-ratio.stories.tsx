import type { Meta, StoryObj } from '@storybook/react-vite'

import { AspectRatio } from './aspect-ratio'

const meta = {
  title: 'Components/AspectRatio',
  component: AspectRatio,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Constrains a child to a fixed width-to-height ratio regardless of its container width — useful for team member headshots, project document previews, and embedded media where the content would otherwise distort or reflow. This is a near-zero-styling passthrough wrapper around Radix\'s AspectRatio primitive; give the child element its own sizing (e.g. `object-cover` on an image) to fill the enforced box.',
      },
    },
  },
} satisfies Meta<typeof AspectRatio>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <div className="w-80">
      <AspectRatio ratio={16 / 9}>
        <div className="flex h-full w-full items-center justify-center rounded-md bg-muted text-sm font-medium text-muted-foreground">
          16:9
        </div>
      </AspectRatio>
    </div>
  ),
}

export const Square: Story = {
  render: () => (
    <div className="w-48">
      <AspectRatio ratio={1}>
        <div className="flex h-full w-full items-center justify-center rounded-md bg-muted text-sm font-medium text-muted-foreground">
          1:1
        </div>
      </AspectRatio>
    </div>
  ),
}
