import type { Meta, StoryObj } from '@storybook/react-vite'
import { Download, ExternalLink, FileText, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'

import { Button } from './button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from './context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu'

const meta = {
  title: 'Components/ContextMenu',
  component: ContextMenu,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A menu of actions triggered by right-click (or press-and-hold on a trackpad) instead of a click target, styled identically to DropdownMenu. Reach for it as a power-user shortcut layered on top of an existing UI, e.g. right-clicking a document row for Open/Download/Rename/Delete. Right-click is a desktop-only affordance — there is no reliable touch equivalent, so treat ContextMenu as pure enhancement: every action it exposes must also be reachable through an on-screen trigger (typically a DropdownMenu behind a "more actions" button) for touch and keyboard-only users. Never gate a feature behind a context menu alone.',
      },
    },
  },
} satisfies Meta<typeof ContextMenu>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  name: 'Document row (right-click + fallback menu)',
  render: () => (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="flex w-96 items-center justify-between gap-3 rounded-lg border border-dashed border-border bg-card p-4 text-card-foreground">
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">Acme Inc. — Q3 Report.pdf</p>
              <p className="text-xs text-muted-foreground">Right-click this row</p>
            </div>
          </div>
          {/* Same actions, reachable without a right-click — required for touch/keyboard users. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Document actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem>
                <ExternalLink /> Open
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Download /> Download
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Pencil /> Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive">
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem>
          <ExternalLink /> Open
          <ContextMenuShortcut>⌘O</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem>
          <Download /> Download
        </ContextMenuItem>
        <ContextMenuItem>
          <Pencil /> Rename
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive">
          <Trash2 /> Delete
          <ContextMenuShortcut>⌘⌫</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  ),
}
