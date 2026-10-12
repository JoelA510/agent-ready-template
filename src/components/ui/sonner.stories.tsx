import type { Meta, StoryObj } from '@storybook/react-vite'

import { Button } from './button'
import { Toaster, toast } from './sonner'

const meta = {
  title: 'Components/Sonner',
  component: Toaster,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "A toast/notification system for brief, transient confirmations — \"Project created,\" \"Invoice sent\" — that report the outcome of an action the user just took, without blocking them from continuing to work. Mount a single `<Toaster />` once near the app root, then call `toast()` from anywhere. Reach for a toast when the user doesn't need to act on the message right away; reach for Alert instead when the message needs to stay visible and anchored in the page (a persistent warning banner on a form), and for Dialog when the user must respond before doing anything else (confirming a destructive action). Unlike every other primitive in this system, Sonner is not Radix-based, so it has no compound Root/Content/Item tree — it's a single Toaster component plus the `toast()` function it re-exports.",
      },
    },
  },
} satisfies Meta<typeof Toaster>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  name: 'Toast triggers',
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Toaster />
      <Button variant="outline" onClick={() => toast('Project created')}>
        Show default toast
      </Button>
      <Button
        variant="outline"
        onClick={() => toast.success('Invoice sent to jane@example.com')}
      >
        Show success toast
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          toast.error('Unable to save changes. Check your connection and try again.')
        }
      >
        Show error toast
      </Button>
    </div>
  ),
}

export const WithAction: Story = {
  name: 'With action (Undo)',
  parameters: {
    docs: {
      description: {
        story:
          'Sonner toasts can carry an inline action button — useful for reversible actions like archiving, where "Undo" right on the confirmation is faster than navigating back to restore it.',
      },
    },
  },
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Toaster />
      <Button
        variant="outline"
        onClick={() =>
          toast('Project archived', {
            action: {
              label: 'Undo',
              onClick: () => toast('Project restored'),
            },
          })
        }
      >
        Show toast with Undo action
      </Button>
    </div>
  ),
}

export const AllVariants: Story = {
  name: 'All variants',
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Toaster />
      <Button variant="outline" onClick={() => toast('Project created')}>
        Default
      </Button>
      <Button
        variant="outline"
        onClick={() => toast.success('Invoice sent to jane@example.com')}
      >
        Success
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          toast.warning('This project has no assigned owner yet.')
        }
      >
        Warning
      </Button>
      <Button
        variant="outline"
        onClick={() => toast.info('Project moved to Active.')}
      >
        Info
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          toast.error('Unable to save changes. Check your connection and try again.')
        }
      >
        Error
      </Button>
    </div>
  ),
}
