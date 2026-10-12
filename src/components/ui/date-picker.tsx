/* eslint-disable jsx-a11y/no-autofocus --
   The calendars below pass `autoFocus` so focus moves into the calendar when its popover
   opens — correct focus management for a popover widget, so keyboard users land on the grid.
   This is not the disorienting on-page-load autofocus that jsx-a11y/no-autofocus guards against. */
import * as React from 'react'
import { format } from 'date-fns'
import { CalendarIcon } from 'lucide-react'
import type { DateRange, Matcher } from 'react-day-picker'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface DatePickerProps {
  value?: Date
  onValueChange?: (date: Date | undefined) => void
  placeholder?: string
  disabled?: Matcher | Matcher[]
  className?: string
  id?: string
  'aria-label'?: string
  'aria-labelledby'?: string
}

/**
 * A single-date picker: Popover + Calendar packaged as one ready-to-use component (see
 * date-picker.stories.tsx for the API this optimizes for). The trigger reads as a button
 * showing the selected date, formatted long-form (e.g. "April 3rd, 2026"), or `placeholder`
 * when nothing is picked yet. Selection is controlled: pass `value` and `onValueChange`.
 * Reach for DateRangePicker instead when the value is a bounded span — a billing period, an
 * engagement term — rather than a single day.
 */
function DatePicker({
  value,
  onValueChange,
  placeholder = 'Pick a date',
  disabled,
  className,
  id,
  ...props
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          data-slot="date-picker-trigger"
          className={cn(
            'w-[240px] justify-start text-left font-normal',
            !value && 'text-muted-foreground',
            className,
          )}
          {...props}
        >
          <CalendarIcon className="text-muted-foreground" />
          {value ? format(value, 'PPP') : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(date) => {
            onValueChange?.(date)
            setOpen(false)
          }}
          disabled={disabled}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  )
}

interface DateRangePickerProps {
  value?: DateRange
  onValueChange?: (range: DateRange | undefined) => void
  placeholder?: string
  disabled?: Matcher | Matcher[]
  numberOfMonths?: number
  className?: string
  id?: string
  'aria-label'?: string
  'aria-labelledby'?: string
}

/**
 * A bounded date-span picker: Popover + Calendar in `mode="range"`, for spans like a
 * billing period or an engagement term rather than a single deadline. Selection is
 * controlled: pass `value` and `onValueChange`. The popover stays open after the first
 * click so the second end of the range can still be picked, and closes once both `from`
 * and `to` are set.
 */
function DateRangePicker({
  value,
  onValueChange,
  placeholder = 'Pick a date range',
  disabled,
  numberOfMonths = 2,
  className,
  id,
  ...props
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false)

  const label = !value?.from
    ? placeholder
    : !value.to
      ? format(value.from, 'PPP')
      : `${format(value.from, 'PPP')} – ${format(value.to, 'PPP')}`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          data-slot="date-range-picker-trigger"
          className={cn(
            'w-[300px] justify-start text-left font-normal',
            !value?.from && 'text-muted-foreground',
            className,
          )}
          {...props}
        >
          <CalendarIcon className="text-muted-foreground" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="range"
          selected={value}
          onSelect={(range) => {
            onValueChange?.(range)
            if (range?.from && range?.to) {
              setOpen(false)
            }
          }}
          disabled={disabled}
          numberOfMonths={numberOfMonths}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  )
}

export { DatePicker, DateRangePicker }
