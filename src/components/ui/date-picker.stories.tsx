import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { DateRange } from 'react-day-picker'

import { Label } from './label'
import { DatePicker, DateRangePicker } from './date-picker'

const meta = {
  title: 'Components/DatePicker',
  component: DatePicker,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A single-date picker composed from Popover + Calendar: a button trigger shows the selected date, or a placeholder, and opens a floating month grid on click. Use DatePicker for a single deadline or effective date; use DateRangePicker for a bounded span like a billing period. Both are controlled — pass `value` and `onValueChange`.',
      },
    },
  },
} satisfies Meta<typeof DatePicker>

export default meta
type Story = StoryObj<typeof meta>

function ProjectDeadlineExample() {
  const [date, setDate] = React.useState<Date | undefined>(new Date(2026, 7, 14))
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="story-project-deadline">Project deadline</Label>
      <DatePicker id="story-project-deadline" value={date} onValueChange={setDate} />
    </div>
  )
}

function ContractStartExample() {
  const [date, setDate] = React.useState<Date | undefined>(undefined)
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="story-contract-start">Contract start date</Label>
      <DatePicker
        id="story-contract-start"
        value={date}
        onValueChange={setDate}
        placeholder="Select a contract start date"
      />
    </div>
  )
}

function BillingPeriodExample() {
  const [range, setRange] = React.useState<DateRange | undefined>({
    from: new Date(2026, 6, 1),
    to: new Date(2026, 6, 31),
  })
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="story-billing-period">Billing period</Label>
      <DateRangePicker id="story-billing-period" value={range} onValueChange={setRange} />
    </div>
  )
}

export const Default: Story = {
  name: 'Project deadline',
  render: () => <ProjectDeadlineExample />,
}

export const Empty: Story = {
  name: 'No date selected',
  render: () => <ContractStartExample />,
}

export const RangePicker: Story = {
  name: 'DateRangePicker — billing period',
  render: () => <BillingPeriodExample />,
}
