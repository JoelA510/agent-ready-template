import type { Meta, StoryObj } from '@storybook/react-vite'

import { Button } from './button'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
} from './card'

const meta = {
  title: 'Components/Card',
  component: Card,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A bordered surface for grouping related content. Compose it from CardHeader, CardTitle, CardDescription, CardAction, CardContent, and CardFooter rather than styling divs by hand — the subcomponents keep spacing and the header/action grid consistent everywhere a card is used.',
      },
    },
  },
} satisfies Meta<typeof Card>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Card className="w-96">
      <CardHeader>
        <CardTitle>Project intake</CardTitle>
        <CardDescription>Confirm the details before routing to the team.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-foreground">
          Card content can hold any layout — text, forms, lists — governed by the same spacing
          scale as the rest of the system.
        </p>
      </CardContent>
      <CardFooter className="gap-2 border-t border-border pt-6">
        <Button variant="outline" size="sm">
          Cancel
        </Button>
        <Button size="sm">Confirm</Button>
      </CardFooter>
    </Card>
  ),
}

export const WithAction: Story = {
  name: 'With header action',
  render: () => (
    <Card className="w-96">
      <CardHeader>
        <CardTitle>Billing</CardTitle>
        <CardDescription>Next invoice on August 1.</CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm">
            Manage
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-foreground">$4,200.00 outstanding across 2 projects.</p>
      </CardContent>
    </Card>
  ),
}

export const ContentOnly: Story = {
  name: 'Content only',
  render: () => (
    <Card className="w-96">
      <CardContent>
        <p className="text-sm text-foreground">
          A minimal card with no header or footer — useful for simple grouped content.
        </p>
      </CardContent>
    </Card>
  ),
}
