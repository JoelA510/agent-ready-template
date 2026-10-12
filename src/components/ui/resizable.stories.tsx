import type { Meta, StoryObj } from '@storybook/react-vite'

import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from './resizable'
import { ScrollArea } from './scroll-area'

const meta = {
  title: 'Components/Resizable',
  component: ResizablePanelGroup,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A split-pane layout built on `react-resizable-panels` (v4): a `ResizablePanelGroup` lays out `ResizablePanel`s along one axis, and a `ResizableHandle` between them lets the user drag the boundary (or resize by keyboard when focused). Set the axis with the native `orientation="horizontal" | "vertical"` prop — v4 renamed the old `direction` prop. Reach for a resizable split only in dense desktop tools where the user genuinely benefits from re-weighting two persistent regions — a list beside a detail pane, an editor above a preview. For narrow or mobile layouts, or when one region is clearly primary, plain stacking or a fixed two-column grid is simpler and more predictable; a draggable handle is friction the user has to discover and manage.',
      },
    },
  },
} satisfies Meta<typeof ResizablePanelGroup>

export default meta
type Story = StoryObj<typeof meta>

const projects = [
  { name: 'Globex — Q3 analytics rollout', category: 'Analytics', lead: 'M. Diaz' },
  { name: 'Initech — data migration', category: 'Engineering', lead: 'S. Rivera' },
  { name: 'Umbrella Corp — onboarding revamp', category: 'Product', lead: 'A. Chen' },
  { name: 'Soylent Corp — billing integration', category: 'Billing', lead: 'D. Cohen' },
  { name: 'Hooli — API portal build', category: 'Platform', lead: 'Y. Kim' },
]

export const Horizontal: Story = {
  name: 'Horizontal — projects list + detail',
  render: () => (
    <div className="h-80 w-full overflow-hidden rounded-lg border border-border">
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel defaultSize="34%" minSize="20%">
          <div className="flex h-full flex-col">
            <div className="border-b border-border px-4 py-3 text-sm font-medium text-foreground">
              Active projects
            </div>
            {/* ScrollArea, not overflow-auto: when the list scrolls and nothing in it can take
                focus, the region becomes the tab stop, so a keyboard can scroll it. */}
            <ScrollArea aria-label="Active projects" className="min-h-0 flex-1">
              <ul>
                {projects.map((project) => (
                  <li
                    key={project.name}
                    className="border-b border-border px-4 py-3 text-sm hover:bg-accent hover:text-accent-foreground"
                  >
                    <p className="font-medium text-foreground">{project.name}</p>
                    <p className="text-muted-foreground">{project.category}</p>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="66%" minSize="30%">
          <div className="flex h-full flex-col gap-4 p-6">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Analytics</p>
              <h3 className="font-serif text-lg font-semibold text-foreground">
                Globex — Q3 analytics rollout
              </h3>
            </div>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-muted-foreground">Project lead</dt>
                <dd className="text-foreground">Morgan Diaz</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Opened</dt>
                <dd className="text-foreground">March 4, 2026</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Billed to date</dt>
                <dd className="font-mono tabular-nums text-foreground">$248,900</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Status</dt>
                <dd className="text-foreground">In progress</dd>
              </div>
            </dl>
            <p className="text-sm text-muted-foreground">
              Drag the divider to give the detail pane more room, or collapse it toward the list
              when scanning the full project roster.
            </p>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  ),
}

export const Vertical: Story = {
  name: 'Vertical — summary above activity',
  render: () => (
    <div className="h-96 w-full max-w-lg overflow-hidden rounded-lg border border-border">
      <ResizablePanelGroup orientation="vertical">
        <ResizablePanel defaultSize="40%" minSize="20%">
          <div className="flex h-full flex-col justify-center gap-1 px-6">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">This week</p>
            <p className="font-serif text-2xl font-semibold text-foreground">
              38.5 hours logged
            </p>
            <p className="text-sm text-muted-foreground">Across 6 projects, 2 teams.</p>
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="60%" minSize="25%">
          <div className="flex h-full flex-col">
            <div className="border-b border-border px-6 py-3 text-sm font-medium text-foreground">
              Recent activity
            </div>
            <ScrollArea aria-label="Recent activity" className="min-h-0 flex-1">
              <ul className="text-sm">
                <li className="border-b border-border px-6 py-3">
                  <span className="text-foreground">Invoice #4821 sent</span>{' '}
                  <span className="text-muted-foreground">— Globex</span>
                </li>
                <li className="border-b border-border px-6 py-3">
                  <span className="text-foreground">Report exported</span>{' '}
                  <span className="text-muted-foreground">— Initech data migration</span>
                </li>
                <li className="border-b border-border px-6 py-3">
                  <span className="text-foreground">Project created</span>{' '}
                  <span className="text-muted-foreground">— Hooli API portal build</span>
                </li>
              </ul>
            </ScrollArea>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  ),
}
