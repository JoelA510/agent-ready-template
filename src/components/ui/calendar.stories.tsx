import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { DateRange } from 'react-day-picker'

import { Calendar } from './calendar'

const meta = {
  title: 'Components/Calendar',
  component: Calendar,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A month grid for picking a day, several days, or a range, built on react-day-picker. Calendar is the low-level primitive; reach for it directly when the date grid needs to stay inline and always visible (a filing-deadline overview, an availability grid), and reach for DatePicker/DateRangePicker instead when it should collapse behind a trigger button.',
      },
    },
  },
} satisfies Meta<typeof Calendar>

export default meta
type Story = StoryObj<typeof meta>

function isWeekend(date: Date) {
  const day = date.getDay()
  return day === 0 || day === 6
}

export const Default: Story = {
  render: function DefaultCalendar() {
    const [selected, setSelected] = React.useState<Date | undefined>(new Date(2026, 7, 14))
    return (
      <Calendar
        mode="single"
        selected={selected}
        onSelect={setSelected}
        disabled={isWeekend}
        defaultMonth={new Date(2026, 7, 14)}
        className="rounded-md border border-border shadow-sm"
      />
    )
  },
}

export const Range: Story = {
  name: 'Range selection',
  render: function RangeCalendar() {
    const [range, setRange] = React.useState<DateRange | undefined>({
      from: new Date(2026, 6, 20),
      to: new Date(2026, 6, 24),
    })
    return (
      <Calendar
        mode="range"
        selected={range}
        onSelect={setRange}
        disabled={isWeekend}
        numberOfMonths={2}
        className="rounded-md border border-border shadow-sm"
      />
    )
  },
}
