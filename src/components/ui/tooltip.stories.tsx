import type { Meta, StoryObj } from '@storybook/react-vite'
import { Info } from 'lucide-react'

import { Button } from './button'
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './tooltip'

const meta = {
  title: 'Components/Tooltip',
  component: Tooltip,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A short, non-blocking label that appears on hover or keyboard focus to clarify what a control does or what a value means — never for content the user must read to proceed, since it disappears the moment focus moves away. Wrap the app root in a single TooltipProvider (it controls shared show/hide delay timing); every Tooltip beneath it can then open instantly on subsequent hovers. Reach for Dialog instead when the user needs to make a decision, not just understand one.',
      },
    },
  },
} satisfies Meta<typeof Tooltip>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon" aria-label="What counts toward usage">
            <Info />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Logged hours divided by each team member&apos;s target hours for the month.</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ),
}
