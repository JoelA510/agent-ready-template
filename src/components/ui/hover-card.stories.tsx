import type { Meta, StoryObj } from '@storybook/react-vite'
import { Briefcase, CalendarClock, TrendingUp } from 'lucide-react'

import { HoverCard, HoverCardContent, HoverCardTrigger } from './hover-card'

const meta = {
  title: 'Components/HoverCard',
  component: HoverCard,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Reveals a rich preview card when the user hovers or focuses a trigger — a teammate or customer mini-profile, a project summary, an invoice-at-a-glance. Use HoverCard when the preview contains structured content (avatar, headings, stats, links) that rewards a glance without a full navigation. For a short, single-line text hint that merely names or explains a control, use Tooltip instead: Tooltip is a terse label, HoverCard is a preview. HoverCard is sighted-pointer/keyboard progressive enhancement, so never hide information behind it that the user strictly needs.',
      },
    },
  },
} satisfies Meta<typeof HoverCard>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  name: 'Teammate preview',
  render: () => (
    <HoverCard>
      <HoverCardTrigger asChild>
        <a
          href="/team/priya-patel"
          className="rounded-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring"
        >
          Priya Patel
        </a>
      </HoverCardTrigger>
      <HoverCardContent>
        <div className="flex gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
            PP
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold leading-none text-foreground">Priya Patel</p>
            <p className="text-sm text-muted-foreground">Manager &middot; Product</p>
          </div>
        </div>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Briefcase className="size-4 shrink-0" />
            <dt className="sr-only">Active projects</dt>
            <dd className="text-foreground">14 active projects</dd>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <TrendingUp className="size-4 shrink-0" />
            <dt className="sr-only">Activity</dt>
            <dd className="text-foreground">Activity 87% this quarter</dd>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <CalendarClock className="size-4 shrink-0" />
            <dt className="sr-only">Hours logged this week</dt>
            <dd className="text-foreground">31.5 hrs logged this week</dd>
          </div>
        </dl>
      </HoverCardContent>
    </HoverCard>
  ),
}

export const ClientPreview: Story = {
  name: 'Customer preview',
  render: () => (
    <p className="max-w-sm text-sm text-foreground">
      The contract is up for renewal with{' '}
      <HoverCard>
        <HoverCardTrigger asChild>
          <a
            href="/accounts/hollis-manufacturing"
            className="rounded-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring"
          >
            Hollis Manufacturing
          </a>
        </HoverCardTrigger>
        <HoverCardContent>
          <div className="flex gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-md bg-secondary text-sm font-semibold text-secondary-foreground">
              HM
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold leading-none text-foreground">
                Hollis Manufacturing
              </p>
              <p className="text-sm text-muted-foreground">Customer since 2019 &middot; Enterprise</p>
            </div>
          </div>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Briefcase className="size-4 shrink-0" />
              <dt className="sr-only">Open projects</dt>
              <dd className="text-foreground">3 open projects</dd>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <TrendingUp className="size-4 shrink-0" />
              <dt className="sr-only">Billed year to date</dt>
              <dd className="text-foreground">$246k billed YTD</dd>
            </div>
          </dl>
        </HoverCardContent>
      </HoverCard>{' '}
      at the end of the quarter.
    </p>
  ),
}
