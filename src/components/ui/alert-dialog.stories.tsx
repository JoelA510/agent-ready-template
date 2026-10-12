import type { Meta, StoryObj } from '@storybook/react-vite'

import { Button, buttonVariants } from './button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './alert-dialog'

const meta = {
  title: 'Components/AlertDialog',
  component: AlertDialog,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A focus-trapped, non-dismissible confirmation for destructive or otherwise consequential actions — voiding an invoice, deleting a project, removing a member from a team. Unlike Dialog it cannot be dismissed by clicking the overlay or pressing a close affordance; the user must make an explicit choice via the Action or Cancel button, so reach for it only when proceeding accidentally would be costly. Use Dialog for general modal content (forms, detail panes, multi-step flows) where dismissing without a decision is harmless. Per Acme UI-copy guidance the description should state the concrete, irreversible consequence rather than a bare "Are you sure?".',
      },
    },
  },
} satisfies Meta<typeof AlertDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  name: 'Void invoice (destructive)',
  render: () => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive">Void invoice</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Void invoice INV-2048?</AlertDialogTitle>
          <AlertDialogDescription>
            Voiding removes the $18,400 billed to Globex Corporation from this billing period.
            The line items return to draft and the customer&rsquo;s statement is reissued. This
            cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep invoice</AlertDialogCancel>
          <AlertDialogAction className={buttonVariants({ variant: 'destructive' })}>
            Void invoice
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ),
}

export const DeleteProject: Story = {
  name: 'Delete project (destructive)',
  render: () => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline">Delete project</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete the Globex onboarding project?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes the project along with its 3 open tasks and 42 activity
            records. Team members assigned to it will lose access immediately and the work will
            not appear in reporting. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction className={buttonVariants({ variant: 'destructive' })}>
            Delete project
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ),
}

export const NonDestructiveConfirm: Story = {
  name: 'Non-destructive confirm',
  render: () => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="primary">Submit for billing</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Submit June invoices for approval?</AlertDialogTitle>
          <AlertDialogDescription>
            This locks all 118 approved line items for June and sends them to the billing
            team. You can still adjust individual line items later, but the period can no longer
            be edited by team members.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Not yet</AlertDialogCancel>
          <AlertDialogAction>Submit for billing</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ),
}
