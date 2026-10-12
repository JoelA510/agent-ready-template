import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'

import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from './menubar'

const meta = {
  title: 'Components/Menubar',
  component: Menubar,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "An always-visible horizontal bar of top-level menu triggers, each opening a dropdown of commands — the File/Edit/View menu bar of a desktop application, not a typical web nav. Reach for Menubar specifically inside internal, desktop-style tools where a dense command set benefits from staying permanently on screen, organized into named menus (an internal project-management console, an admin back office). For a marketing- or product-facing primary nav bar, use NavigationMenu instead; for a single click-triggered list of actions anywhere on a page (a row's \"...\" button, an avatar menu), use DropdownMenu.",
      },
    },
  },
} satisfies Meta<typeof Menubar>

export default meta
type Story = StoryObj<typeof meta>

function DefaultMenubarExample() {
  const [showTimekeeping, setShowTimekeeping] = React.useState(true)
  const [showIntake, setShowIntake] = React.useState(false)
  const [density, setDensity] = React.useState('comfortable')

  return (
    <Menubar>
      <MenubarMenu>
        <MenubarTrigger>File</MenubarTrigger>
        <MenubarContent>
          <MenubarItem>
            New project
            <MenubarShortcut>⌘N</MenubarShortcut>
          </MenubarItem>
          <MenubarSub>
            <MenubarSubTrigger>Open recent</MenubarSubTrigger>
            <MenubarSubContent>
              <MenubarItem>Analytics dashboard redesign</MenubarItem>
              <MenubarItem>Onboarding flow — Initech</MenubarItem>
              <MenubarItem>Billing migration — Umbrella Corp</MenubarItem>
            </MenubarSubContent>
          </MenubarSub>
          <MenubarSeparator />
          <MenubarItem>
            Export as PDF
            <MenubarShortcut>⌘E</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem variant="destructive">Close project</MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger>View</MenubarTrigger>
        <MenubarContent>
          <MenubarLabel>Dashboard widgets</MenubarLabel>
          <MenubarSeparator />
          <MenubarCheckboxItem checked={showTimekeeping} onCheckedChange={setShowTimekeeping}>
            Timekeeping summary
          </MenubarCheckboxItem>
          <MenubarCheckboxItem checked={showIntake} onCheckedChange={setShowIntake}>
            New intake requests
          </MenubarCheckboxItem>
          <MenubarSeparator />
          <MenubarLabel>Density</MenubarLabel>
          <MenubarSeparator />
          <MenubarRadioGroup value={density} onValueChange={setDensity}>
            <MenubarRadioItem value="comfortable">Comfortable</MenubarRadioItem>
            <MenubarRadioItem value="compact">Compact</MenubarRadioItem>
          </MenubarRadioGroup>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger>Help</MenubarTrigger>
        <MenubarContent>
          <MenubarItem>Acme support</MenubarItem>
          <MenubarItem>Keyboard shortcuts</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  )
}

export const Default: Story = {
  name: 'File / View / Help',
  render: () => <DefaultMenubarExample />,
}
