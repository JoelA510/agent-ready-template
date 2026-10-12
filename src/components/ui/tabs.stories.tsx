import type { Meta, StoryObj } from '@storybook/react-vite'

import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs'

const meta = {
  title: 'Components/Tabs',
  component: Tabs,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "A Radix-backed set of panels shown one at a time, switched by an always-visible row of triggers. Reach for Tabs when someone needs to jump between a handful of related views of the same record — a project's overview, documents, and billing — without leaving the page. Prefer Accordion for a long list of independent sections that can stay collapsed, and prefer real links/routes for navigating between entirely different pages.",
      },
    },
  },
} satisfies Meta<typeof Tabs>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Tabs defaultValue="overview" className="w-[28rem]">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="documents">Documents</TabsTrigger>
        <TabsTrigger value="billing">Billing</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">
        <p className="text-sm text-foreground">
          Meridian Retail — customer portal redesign. Product engagement opened
          March 2026. Project lead: Priya Anand.
        </p>
      </TabsContent>
      <TabsContent value="documents">
        <p className="text-sm text-foreground">
          14 documents on file, including the signed contract, requirements draft v3, and
          design review templates.
        </p>
      </TabsContent>
      <TabsContent value="billing">
        <p className="text-sm text-foreground">
          $6,450.00 billed to date across 12.9 hours. Next invoice cycle closes August 1.
        </p>
      </TabsContent>
    </Tabs>
  ),
}

export const Disabled: Story = {
  render: () => (
    <Tabs defaultValue="overview" className="w-[28rem]">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="documents">Documents</TabsTrigger>
        <TabsTrigger value="billing" disabled>
          Billing
        </TabsTrigger>
      </TabsList>
      <TabsContent value="overview">
        <p className="text-sm text-foreground">
          Meridian Retail — customer portal redesign. Product engagement opened
          March 2026. Project lead: Priya Anand.
        </p>
      </TabsContent>
      <TabsContent value="documents">
        <p className="text-sm text-foreground">
          14 documents on file, including the signed contract and requirements draft v3.
        </p>
      </TabsContent>
    </Tabs>
  ),
}
