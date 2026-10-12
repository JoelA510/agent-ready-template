import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { Separator } from './separator'
import { ScrollArea } from './scroll-area'

const meta = {
  title: 'Components/ScrollArea',
  component: ScrollArea,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A cross-browser, token-styled replacement for a native scrollbar. Reach for it whenever a fixed-height or fixed-width region needs to scroll independently of the page — a project list in a side panel, a long dropdown or dialog body — and the default OS scrollbar would look inconsistent across platforms or clash with the surrounding chrome. For content that should scroll with the page itself, just let it overflow naturally; ScrollArea is for contained regions.',
      },
    },
  },
} satisfies Meta<typeof ScrollArea>

export default meta
type Story = StoryObj<typeof meta>

const projects = [
  { name: 'Acme — Customer Portal Redesign', area: 'Product' },
  { name: 'Globex — Data Warehouse Migration', area: 'Engineering' },
  { name: 'Initech — Billing Integration', area: 'Billing' },
  { name: 'Umbrella Corp — Onboarding Revamp', area: 'Product' },
  { name: 'Soylent Corp — Quarterly Planning Retreat', area: 'Operations' },
  { name: 'Hooli — Platform Merger', area: 'Engineering' },
  { name: 'Vandelay Industries — Import Pipeline', area: 'Data' },
  { name: 'Stark Industries — Access Control Review', area: 'Security' },
  { name: 'Wayne Enterprises — Vendor Contract Renewal', area: 'Procurement' },
  { name: 'Wonka Industries — Warehouse Automation', area: 'Operations' },
  { name: 'Massive Dynamic — Provisional Feature Flags', area: 'Platform' },
  { name: 'Cyberdyne Systems — Uptime Audit', area: 'Reliability' },
  { name: 'Globex — Design System Rollout', area: 'Design' },
  { name: 'Nimbus Labs — Brand Refresh', area: 'Marketing' },
  { name: 'Osprey Retail — Storefront Refresh', area: 'Product' },
  { name: 'Pinnacle Health — Headcount Planning', area: 'People' },
  { name: 'Quimby Retail Group — Lease Renewal', area: 'Facilities' },
  { name: 'Rivera Foods — Succession Planning', area: 'Operations' },
  { name: 'Sable Ridge — Reseller Agreement', area: 'Sales' },
  { name: 'Tolliver Manufacturing — Capacity Review', area: 'Engineering' },
]

const viewportOf = (canvasElement: HTMLElement) =>
  canvasElement.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')

export const Default: Story = {
  name: 'Project list',
  render: () => (
    <ScrollArea aria-label="Open projects" className="h-72 w-96 rounded-lg border border-border bg-card">
      <div className="p-4">
        <h4 className="mb-3 font-serif text-sm font-semibold text-foreground">
          Open projects ({projects.length})
        </h4>
        {projects.map((project, index) => (
          <div key={project.name}>
            <div className="py-2 text-sm">
              <p className="text-foreground">{project.name}</p>
              <p className="text-xs text-muted-foreground">{project.area}</p>
            </div>
            {index < projects.length - 1 && <Separator />}
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
  // Nothing inside can take focus, so the scrolling region does: a keyboard user tabs to it, sees
  // where focus is, and scrolls with the arrow keys. Runs in the browser tier (needs layout).
  play: async ({ canvasElement }) => {
    const viewport = viewportOf(canvasElement)
    await expect(viewport).not.toBeNull()
    await waitFor(() => expect(viewport).toHaveAttribute('tabindex', '0'))
    await expect(viewport).toHaveAccessibleName('Open projects')
    await userEvent.tab()
    await expect(viewport).toHaveFocus()
    const style = getComputedStyle(viewport!)
    await expect(style.outlineStyle).toBe('solid')
    await expect(Number.parseFloat(style.outlineWidth)).toBeGreaterThanOrEqual(2)
  },
}

export const WithLinks: Story = {
  name: 'Links inside',
  render: () => (
    <ScrollArea aria-label="Recent projects" className="h-72 w-96 rounded-lg border border-border bg-card">
      <ul className="p-4">
        {projects.map((project) => (
          <li key={project.name}>
            <a
              href={`/projects/${encodeURIComponent(project.name)}`}
              className="block rounded-sm py-2 text-sm text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring"
            >
              {project.name}
            </a>
          </li>
        ))}
      </ul>
    </ScrollArea>
  ),
  // The links are reachable, and focusing one scrolls it into view, so the region adds no tab
  // stop of its own: Tab goes straight to the first link.
  play: async ({ canvasElement }) => {
    const viewport = viewportOf(canvasElement)
    await userEvent.tab()
    await expect(within(canvasElement).getAllByRole('link')[0]).toHaveFocus()
    await expect(viewport).not.toHaveAttribute('tabindex')
  },
}
