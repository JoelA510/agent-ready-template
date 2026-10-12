import type { Meta, StoryObj } from '@storybook/react-vite'

import { Button } from './button'
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
} from './drawer'

const meta = {
  title: 'Components/Drawer',
  component: Drawer,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "A bottom sheet built on vaul with a real drag-to-dismiss touch gesture, rather than Sheet's simple slide-in animation. Recommended default, not committed: most of this system's product surfaces are desktop-first internal tools, so Sheet should stay the default reach for an edge panel — treat Drawer as the deliberate exception, reached for only when a screen is genuinely mobile/touch-first and a physical drag gesture materially improves the interaction (e.g. a phone-width project summary card). If the surface isn't touch-first, use Sheet instead.",
      },
    },
  },
} satisfies Meta<typeof Drawer>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Drawer>
      <DrawerTrigger asChild>
        <Button variant="outline">View project summary</Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Analytics dashboard redesign</DrawerTitle>
          <DrawerDescription>In progress — opened March 14, 2025</DrawerDescription>
        </DrawerHeader>
        <div className="space-y-2 text-sm text-foreground">
          <p>
            A redesign of the customer analytics dashboard for Globex. Currently in build; the
            next milestone is the design review due August 8.
          </p>
          <p className="text-muted-foreground">
            Project lead: Priya Patel. 34.5 hours logged, unbilled this cycle.
          </p>
        </div>
        <DrawerFooter>
          <DrawerClose asChild>
            <Button variant="outline">Close</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  ),
}
