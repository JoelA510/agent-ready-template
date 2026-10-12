import type { Meta, StoryObj } from '@storybook/react-vite'
import { ChevronsUpDown } from 'lucide-react'

import { Button } from './button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible'

const meta = {
  title: 'Components/Collapsible',
  component: Collapsible,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The unstyled, lower-level show/hide primitive that Accordion is conceptually built from — a single trigger that toggles a single region of content, with no default visual treatment of its own. Reach for Collapsible directly when you need one "show more" / "show details" toggle composed with your own trigger (often a Button); reach for Accordion instead when you need a themed, multi-item list of independent sections.',
      },
    },
  },
} satisfies Meta<typeof Collapsible>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  name: 'Show more documents',
  render: () => (
    <Collapsible className="w-full max-w-md">
      <div className="rounded-lg border border-border bg-card p-4 text-sm text-card-foreground shadow-sm">
        Project brief — approved
      </div>
      <div className="mt-2 rounded-lg border border-border bg-card p-4 text-sm text-card-foreground shadow-sm">
        Requirements doc — draft v3
      </div>
      <CollapsibleTrigger asChild>
        <Button variant="outline" size="sm" className="mt-2 w-full justify-between">
          3 more documents
          <ChevronsUpDown className="size-4" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 flex flex-col gap-2">
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-card-foreground shadow-sm">
          Kickoff notes — Q2 planning
        </div>
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-card-foreground shadow-sm">
          Onboarding checklist template
        </div>
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-card-foreground shadow-sm">
          Incident response runbook
        </div>
      </CollapsibleContent>
    </Collapsible>
  ),
}
