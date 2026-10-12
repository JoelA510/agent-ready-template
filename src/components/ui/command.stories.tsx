import type { Meta, StoryObj } from '@storybook/react-vite'
import { Building2, FilePlus, Scale, UserPlus } from 'lucide-react'

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from './command'

const meta = {
  title: 'Components/Command',
  component: Command,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A cmdk-backed searchable list: type-ahead filtering, keyboard navigation, and grouped results over any set of items. Composed inside a Popover it becomes a Combobox (see Combobox); rendered on its own, unpopover-ed, it works as a persistent command palette or search block sitting directly in the page. This file wraps cmdk\'s own component tree — Command, CommandInput, CommandList, CommandGroup, CommandItem, and friends — 1:1, the same way this library\'s Radix wrappers stay close to their primitive\'s API, so it stays reusable as the shared base for both compositions rather than picking up Combobox-specific behavior here.',
      },
    },
  },
} satisfies Meta<typeof Command>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Command className="w-[420px] border border-border shadow-md" label="Search projects and customers">
      <CommandInput placeholder="Search projects and customers..." />
      <CommandList>
        <CommandEmpty>No projects or customers found.</CommandEmpty>
        <CommandGroup heading="Projects">
          <CommandItem value="website-redesign">
            Website redesign
          </CommandItem>
          <CommandItem value="mobile-app-launch">
            Mobile app launch
          </CommandItem>
          <CommandItem value="payments-integration">
            Payments integration
          </CommandItem>
          <CommandItem value="q3-analytics-rollout">
            Q3 analytics rollout
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Customers">
          <CommandItem value="globex-corporation">Globex Corporation</CommandItem>
          <CommandItem value="initech">Initech</CommandItem>
          <CommandItem value="umbrella-corp">Umbrella Corp</CommandItem>
          <CommandItem value="hooli">Hooli</CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  ),
}

export const Empty: Story = {
  name: 'Empty state',
  parameters: {
    // While the filter matches nothing, the list (role="listbox") is legitimately empty, so
    // axe's aria-required-children ("a listbox must contain option/group") fires. That's inherent
    // to a searchable empty state, not a component defect: the user hears "No projects or
    // customers found.", and the listbox repopulates as soon as a query matches. Fixing it would
    // mean overriding cmdk's role management. Every other rule still runs on this story, in
    // Chromium and in jsdom.
    a11y: { options: { rules: { 'aria-required-children': { enabled: false } } } },
  },
  render: () => (
    <Command className="w-[420px] border border-border shadow-md" label="Search projects and customers">
      <CommandInput placeholder="Search projects and customers..." />
      <CommandList>
        <CommandEmpty>No projects or customers found.</CommandEmpty>
      </CommandList>
    </Command>
  ),
}

export const DisabledItem: Story = {
  name: 'Disabled item',
  render: () => (
    <Command className="w-[420px] border border-border shadow-md" label="Search projects and customers">
      <CommandInput placeholder="Search projects and customers..." />
      <CommandList>
        <CommandEmpty>No projects or customers found.</CommandEmpty>
        <CommandGroup heading="Projects">
          <CommandItem value="website-redesign">
            Website redesign
          </CommandItem>
          <CommandItem value="mobile-app-launch" disabled>
            Mobile app launch (archived)
          </CommandItem>
          <CommandItem value="payments-integration">
            Payments integration
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  ),
}

export const AsCommandPalette: Story = {
  name: 'As a persistent command palette',
  render: () => (
    <Command className="w-[420px] border border-border shadow-md" label="Command palette">
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No matching commands.</CommandEmpty>
        <CommandGroup heading="Quick actions">
          <CommandItem value="new-project">
            <FilePlus /> New project
            <CommandShortcut>⌘N</CommandShortcut>
          </CommandItem>
          <CommandItem value="new-customer">
            <UserPlus /> New customer
            <CommandShortcut>⌘⇧C</CommandShortcut>
          </CommandItem>
          <CommandItem value="new-report">
            <Building2 /> New report
          </CommandItem>
          <CommandItem value="search-customers">
            <Scale /> Search customers
            <CommandShortcut>⌘⇧L</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  ),
}
