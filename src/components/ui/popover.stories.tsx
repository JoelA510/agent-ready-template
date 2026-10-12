import type { Meta, StoryObj } from '@storybook/react-vite'

import { Button } from './button'
import { Input } from './input'
import { Label } from './label'
import { Popover, PopoverContent, PopoverTrigger } from './popover'

const meta = {
  title: 'Components/Popover',
  component: Popover,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "A plain floating panel anchored to a trigger, for content the user opts into by clicking — a filter form, an inline editor, a supplementary detail view. Popover is the generic building block other floating-content components (Combobox, Date Picker) are composed from, so it carries no opinionated behavior beyond positioning and open/close animation. Reach for it directly when you need an anchored panel that isn't a list of actions (use DropdownMenu for that) and isn't a passive, non-interactive hint (use Tooltip for that).",
      },
    },
  },
} satisfies Meta<typeof Popover>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">Filters</Button>
      </PopoverTrigger>
      <PopoverContent>
        <div className="grid gap-4">
          <div className="grid gap-1">
            <h4 className="font-serif text-sm font-semibold text-foreground">Filter projects</h4>
            <p className="text-sm text-muted-foreground">Narrow the list by date opened.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="story-popover-from">From</Label>
              <Input id="story-popover-from" type="date" defaultValue="2026-01-01" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="story-popover-to">To</Label>
              <Input id="story-popover-to" type="date" defaultValue="2026-07-22" />
            </div>
          </div>
          <Button size="sm">Apply filters</Button>
        </div>
      </PopoverContent>
    </Popover>
  ),
}
