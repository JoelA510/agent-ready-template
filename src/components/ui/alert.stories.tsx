import type { Meta, StoryObj } from '@storybook/react-vite'
import { Info as InfoIcon, CircleCheck, TriangleAlert, CircleX } from 'lucide-react'

import { Alert, AlertTitle, AlertDescription } from './alert'

const meta = {
  title: 'Components/Alert',
  component: Alert,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A banner for surfacing a single important message inline with page content — form submission results, system status, or a heads-up before a destructive action. Compose it from AlertTitle and AlertDescription, with an optional leading icon passed as a normal child. For transient, self-dismissing feedback prefer a toast instead; reach for Alert when the message should stay visible until the underlying condition changes.',
      },
    },
  },
} satisfies Meta<typeof Alert>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Alert className="w-96">
      <InfoIcon />
      <AlertTitle>Heads up</AlertTitle>
      <AlertDescription>
        Your agreement is ready for signature before we can start the project.
      </AlertDescription>
    </Alert>
  ),
}

export const Destructive: Story = {
  render: () => (
    <Alert variant="destructive" className="w-96">
      <CircleX />
      <AlertTitle>Unable to save changes</AlertTitle>
      <AlertDescription>Check your connection and try again.</AlertDescription>
    </Alert>
  ),
}

export const Success: Story = {
  render: () => (
    <Alert variant="success" className="w-96">
      <CircleCheck />
      <AlertTitle>Invoice sent</AlertTitle>
      <AlertDescription>The July billing summary was emailed to the customer.</AlertDescription>
    </Alert>
  ),
}

export const Warning: Story = {
  render: () => (
    <Alert variant="warning" className="w-96">
      <TriangleAlert />
      <AlertTitle>Credits running low</AlertTitle>
      <AlertDescription>
        This project has less than 10% of its credit balance remaining.
      </AlertDescription>
    </Alert>
  ),
}

export const Info: Story = {
  render: () => (
    <Alert variant="info" className="w-96">
      <InfoIcon />
      <AlertTitle>Scheduled maintenance</AlertTitle>
      <AlertDescription>
        Customer portal access will be briefly unavailable this Sunday at 6am.
      </AlertDescription>
    </Alert>
  ),
}
