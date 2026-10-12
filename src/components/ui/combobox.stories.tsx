import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { Combobox, type ComboboxOption } from './combobox'
import { Label } from './label'

const meta = {
  title: 'Components/Combobox',
  component: Combobox,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A searchable Select: Popover + Command wired together so the option list can be filtered by typing rather than only scrolled. Reach for Combobox instead of Select once the list is long enough — team members, projects, customers — that finding an entry by scanning stops being practical. Selection is controlled: pass `value` and `onValueChange`.',
      },
    },
  },
} satisfies Meta<typeof Combobox>

export default meta
type Story = StoryObj<typeof meta>

const ownerOptions: ComboboxOption[] = [
  { value: 'lee-jordan', label: 'Jordan Lee — Engineering' },
  { value: 'patel-priya', label: 'Priya Patel — Sales' },
  { value: 'rivera-sam', label: 'Sam Rivera — Product' },
  { value: 'chen-alex', label: 'Alex Chen — Design' },
  { value: 'diaz-morgan', label: 'Morgan Diaz — Marketing' },
  { value: 'kim-taylor', label: 'Taylor Kim — Operations' },
  { value: 'okafor-riley', label: 'Riley Okafor — Engineering' },
  { value: 'nguyen-casey', label: 'Casey Nguyen — Support' },
  { value: 'cohen-dana', label: 'Dana Cohen — Finance' },
  { value: 'alvarez-noah', label: 'Noah Alvarez — Sales' },
  { value: 'rossi-maya', label: 'Maya Rossi — Support' },
  { value: 'klein-berg-ezra', label: 'Ezra Klein-Berg — Design' },
  { value: 'bennett-leah', label: 'Leah Bennett — Product' },
  { value: 'haddad-omar', label: 'Omar Haddad — Analytics' },
]

function AssignOwnerExample() {
  const [owner, setOwner] = React.useState('')
  return (
    <Combobox
      options={ownerOptions}
      value={owner}
      onValueChange={setOwner}
      placeholder="Select an owner..."
      searchPlaceholder="Search team..."
      emptyText="No team member found."
      className="w-72"
      aria-label="Assign owner"
    />
  )
}

function WithLabelExample() {
  const [owner, setOwner] = React.useState('rivera-sam')
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="story-combobox-owner">Assigned owner</Label>
      <Combobox
        id="story-combobox-owner"
        options={ownerOptions}
        value={owner}
        onValueChange={setOwner}
        placeholder="Select an owner..."
        searchPlaceholder="Search team..."
        emptyText="No team member found."
        className="w-72"
      />
    </div>
  )
}

export const Default: Story = {
  args: { options: ownerOptions },
  render: () => <AssignOwnerExample />,
}

export const WithLabel: Story = {
  name: 'With label',
  args: { options: ownerOptions },
  render: () => <WithLabelExample />,
}
