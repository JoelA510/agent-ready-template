import type { Meta, StoryObj } from '@storybook/react-vite'

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './accordion'

const meta = {
  title: 'Components/Accordion',
  component: Accordion,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "A vertically stacked set of headers that each reveal or hide an associated section of content. Reach for Accordion for a long list of independent sections that can stay collapsed by default — an FAQ, a project's expandable details — where showing everything at once would be overwhelming. Prefer Tabs when someone needs to switch between a small, fixed set of related views of the same record; prefer Collapsible directly (unstyled) when you only need a single show/hide section rather than a themed multi-item list.",
      },
    },
  },
  args: {
    // Radix's Accordion.Root discriminates its whole prop shape on `type` ("single" vs.
    // "multiple" changes whether `value`/`onValueChange` are a string or a string[]), so
    // it's the one required prop here — set a default so individual stories only need to
    // override it when they actually want `type="multiple"`.
    type: 'single',
  },
} satisfies Meta<typeof Accordion>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Accordion type="single" collapsible className="w-full max-w-xl">
      <AccordionItem value="intake">
        <AccordionTrigger>
          What information do you need to create a project?
        </AccordionTrigger>
        <AccordionContent>
          We&apos;ll need the project name, a short description of the work, and the team
          members who should have access before any work begins. Your workspace admin can
          usually set this up within one business day.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="billing">
        <AccordionTrigger>How is billing calculated?</AccordionTrigger>
        <AccordionContent>
          Most projects bill hourly against the rate set in your contract, in six-minute
          increments. Fixed-scope engagements are often flat-fee instead — check your account
          settings to see which applies to your project.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="documents">
        <AccordionTrigger>How do I share documents securely?</AccordionTrigger>
        <AccordionContent>
          Upload files directly through your customer portal rather than email — it&apos;s
          encrypted in transit and at rest, and every document is automatically attached to
          the correct project for your team to review.
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
}

export const Multiple: Story = {
  args: { type: 'multiple' },
  render: () => (
    <Accordion type="multiple" defaultValue={['projects', 'team']} className="w-full max-w-xl">
      <AccordionItem value="projects">
        <AccordionTrigger>Projects</AccordionTrigger>
        <AccordionContent>
          Create, organize, and track work across your organization. Group related tasks,
          assign owners, and set milestones so everyone can see what is on track and what
          needs attention.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="team">
        <AccordionTrigger>Team</AccordionTrigger>
        <AccordionContent>
          Invite teammates, group them into teams, and manage roles and permissions. Admins
          control who can view billing, edit projects, and export reports, so access stays
          aligned with responsibility as the organization grows.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="reports">
        <AccordionTrigger>Reports</AccordionTrigger>
        <AccordionContent>
          Build dashboards and scheduled reports from your project and usage data — a working
          set of stakeholder-ready summaries with real milestones for organizations ready to
          set direction for the next three to five quarters.
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
}
