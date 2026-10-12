import type { Meta, StoryObj } from '@storybook/react-vite'

import { Avatar, AvatarFallback, AvatarImage } from './avatar'

const meta = {
  title: 'Components/Avatar',
  component: Avatar,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "A Radix-backed circular image used to represent a person — a teammate, customer contact, or admin — in lists, headers, and assignment pickers. AvatarFallback renders initials automatically whenever AvatarImage has no src, a broken src, or hasn't finished loading, so a person is never shown as a broken-image icon.",
      },
    },
  },
} satisfies Meta<typeof Avatar>

export default meta
type Story = StoryObj<typeof meta>

export const WithImage: Story = {
  name: 'With image',
  render: () => (
    <Avatar>
      <AvatarImage src="https://i.pravatar.cc/150?img=12" alt="Priya Anand" />
      <AvatarFallback>PA</AvatarFallback>
    </Avatar>
  ),
}

export const FallbackInitials: Story = {
  name: 'Fallback initials',
  render: () => (
    <Avatar>
      <AvatarImage src="https://broken-image-url.example/avatar.jpg" alt="Jordan Diaz" />
      <AvatarFallback>JD</AvatarFallback>
    </Avatar>
  ),
}

export const Group: Story = {
  name: 'Assigned team',
  render: () => (
    <div className="flex -space-x-2">
      <Avatar className="ring-2 ring-background">
        <AvatarImage src="https://i.pravatar.cc/150?img=12" alt="Priya Anand" />
        <AvatarFallback>PA</AvatarFallback>
      </Avatar>
      <Avatar className="ring-2 ring-background">
        <AvatarFallback>JD</AvatarFallback>
      </Avatar>
      <Avatar className="ring-2 ring-background">
        <AvatarFallback>MK</AvatarFallback>
      </Avatar>
      <Avatar className="ring-2 ring-background">
        <AvatarFallback>SL</AvatarFallback>
      </Avatar>
    </div>
  ),
}
