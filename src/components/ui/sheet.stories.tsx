import type { Meta, StoryObj } from '@storybook/react-vite'

import { Button } from './button'
import { Input } from './input'
import { Label } from './label'
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetClose,
} from './sheet'

const meta = {
  title: 'Components/Sheet',
  component: Sheet,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "A panel that slides in from a screen edge without leaving the current page context — it wraps the same Radix Dialog primitive as Dialog, just anchored to an edge instead of centered. Reach for Sheet for a standard desktop side panel: editing a record's details, a filters panel, or anything the user should be able to reference alongside the page behind it. Use Dialog instead when the interaction should fully block the page for a decision or confirmation; use Drawer instead of Sheet when the surface is mobile/touch-first and a real drag-to-dismiss gesture is more important than a simple slide.",
      },
    },
  },
} satisfies Meta<typeof Sheet>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">Edit customer details</Button>
      </SheetTrigger>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Edit customer details</SheetTitle>
          <SheetDescription>
            Update contact information for Globex Corporation. Changes apply to every open
            project for this customer.
          </SheetDescription>
        </SheetHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="story-sheet-customer-name">Customer name</Label>
            <Input id="story-sheet-customer-name" defaultValue="Globex Corporation" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="story-sheet-primary-contact">Primary contact</Label>
            <Input id="story-sheet-primary-contact" defaultValue="Dana Cohen" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="story-sheet-billing-email">Billing email</Label>
            <Input
              id="story-sheet-billing-email"
              type="email"
              defaultValue="billing@globex.example"
            />
          </div>
        </div>
        <SheetFooter>
          <SheetClose asChild>
            <Button variant="outline">Cancel</Button>
          </SheetClose>
          <Button>Save changes</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  ),
}

export const Left: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">Open project navigator</Button>
      </SheetTrigger>
      <SheetContent side="left">
        <SheetHeader>
          <SheetTitle>Project navigator</SheetTitle>
          <SheetDescription>Jump to another open project without leaving this view.</SheetDescription>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  ),
}

export const Top: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">Show company announcement</Button>
      </SheetTrigger>
      <SheetContent side="top">
        <SheetHeader>
          <SheetTitle>Billing cycle reminder</SheetTitle>
          <SheetDescription>
            Invoices for this billing cycle go out Friday at 5:00pm.
          </SheetDescription>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  ),
}

export const Bottom: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">Add update</Button>
      </SheetTrigger>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>Quick update</SheetTitle>
          <SheetDescription>Post an update to the project currently open.</SheetDescription>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  ),
}
