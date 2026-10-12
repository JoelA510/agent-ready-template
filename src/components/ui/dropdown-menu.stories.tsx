import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { MoreHorizontal } from 'lucide-react'

import { Avatar, AvatarFallback } from './avatar'
import { Button } from './button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './dropdown-menu'

const meta = {
  title: 'Components/DropdownMenu',
  component: DropdownMenu,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "A menu of actions anchored to a trigger and opened on click. Reach for DropdownMenu for row-level actions on a list item (open, assign, delete) and for account-level menus (an avatar's Profile/Settings/Log out); for a fixed set of choices bound to a single value use Select instead, and for a passive hint rather than a list of actions use Tooltip or Popover.",
      },
    },
  },
} satisfies Meta<typeof DropdownMenu>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  name: 'Row actions',
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Project actions">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem>Open project</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Assign owner</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>Priya Patel</DropdownMenuItem>
            <DropdownMenuItem>Sam Rivera</DropdownMenuItem>
            <DropdownMenuItem>Alex Chen</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuCheckboxItem checked>Show in dashboard</DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">
          Delete project
          <DropdownMenuShortcut>⌘⌫</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}

function SortMenuExample() {
  const [sort, setSort] = React.useState('opened-desc')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Sort by</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>Sort projects by</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={sort} onValueChange={setSort}>
          <DropdownMenuRadioItem value="opened-desc">Date opened (newest)</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="customer-asc">Customer name (A-Z)</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="category">Category</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>Export as CSV</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export const SortMenu: Story = {
  name: 'Sort menu (radio group)',
  render: () => <SortMenuExample />,
}

export const UserMenu: Story = {
  name: 'User menu',
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* The name starts with the initials the button shows, so someone using speech input
            can say what they see (WCAG 2.5.3, Label in Name). */}
        <button
          type="button"
          aria-label="DC, account menu for Dana Cohen"
          className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring"
        >
          <Avatar>
            <AvatarFallback>DC</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Dana Cohen</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>Profile</DropdownMenuItem>
        <DropdownMenuItem>Settings</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem>Log out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}
