import * as React from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react'
import { DayPicker } from 'react-day-picker'
import type { ChevronProps, DayButtonProps, RootProps } from 'react-day-picker'

import { cn } from '@/lib/utils'
import { Button, buttonVariants } from '@/components/ui/button'

// react-day-picker v10 (this repo's installed version) restructured customization
// substantially from the v8-era API most published shadcn/ui Calendar examples target:
// there's no more `IconLeft`/`IconRight`/`nav_button_previous` — the classNames map is
// keyed by the `UI`/`DayFlag`/`SelectionState` string enums (`day`, `day_button`,
// `button_previous`, `range_start`, `today`, `outside`, `disabled`, …), and per-part
// rendering is swapped via the `components` prop (`Root`, `Chevron`, `DayButton`, …).
// Verified directly against the installed package's type declarations before writing
// this file — see node_modules/react-day-picker/dist/esm/{UI,types/shared}.d.ts.
function Calendar({
  className,
  classNames,
  components,
  showOutsideDays = true,
  navLayout = 'around',
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      navLayout={navLayout}
      className={cn('w-fit p-3', className)}
      classNames={{
        months: 'relative flex flex-col gap-4 sm:flex-row',
        month: 'relative flex w-full flex-col gap-4',
        month_caption: 'relative flex h-9 items-center justify-center px-9',
        caption_label: 'text-sm font-medium text-foreground',
        nav: 'flex items-center gap-1',
        button_previous: cn(
          buttonVariants({ variant: 'outline', size: 'icon' }),
          'absolute left-0 top-0',
        ),
        button_next: cn(
          buttonVariants({ variant: 'outline', size: 'icon' }),
          'absolute right-0 top-0',
        ),
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday: 'w-9 text-center text-[0.8rem] font-normal text-muted-foreground',
        week: 'mt-2 flex w-full',
        day: 'relative h-9 w-9 p-0 text-center text-sm focus-within:relative focus-within:z-20',
        outside: 'text-muted-foreground',
        disabled: 'pointer-events-none text-muted-foreground opacity-50',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Root: CalendarRoot,
        Chevron: CalendarChevron,
        DayButton: CalendarDayButton,
        ...components,
      }}
      {...props}
    />
  )
}

function CalendarRoot({ className, rootRef, ...props }: RootProps) {
  return <div data-slot="calendar" ref={rootRef} className={cn(className)} {...props} />
}

function CalendarChevron({ className, orientation, ...props }: ChevronProps) {
  const icons = {
    left: ChevronLeft,
    right: ChevronRight,
    up: ChevronUp,
    down: ChevronDown,
  } as const
  const Icon = icons[orientation ?? 'right']

  return <Icon className={cn('size-4', className)} {...props} />
}

// The day cell (`Day`, a <td>) and the button inside it (`DayButton`) are separate
// slots in v10 — selection/today/range state lives on `modifiers`, passed straight to
// this component, so the primary/accent treatment is applied here rather than via a
// `day_selected`-style classNames key (that key no longer exists in this version).
function CalendarDayButton({
  className,
  day,
  modifiers,
  children,
  'aria-label': ariaLabel,
  ...props
}: DayButtonProps) {
  const ref = React.useRef<HTMLButtonElement>(null)

  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus()
  }, [modifiers.focused])

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      aria-label={nameWithShownDay(ariaLabel, children)}
      data-day={day.date.toLocaleDateString()}
      data-today={(modifiers.today && !modifiers.selected) || undefined}
      data-selected-single={
        (modifiers.selected &&
          !modifiers.range_start &&
          !modifiers.range_end &&
          !modifiers.range_middle) ||
        undefined
      }
      data-range-start={modifiers.range_start || undefined}
      data-range-end={modifiers.range_end || undefined}
      data-range-middle={modifiers.range_middle || undefined}
      className={cn(
        'font-normal',
        'data-[today=true]:border data-[today=true]:border-primary data-[today=true]:text-foreground',
        'data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground',
        'data-[selected-single=true]:hover:bg-primary data-[selected-single=true]:hover:text-primary-foreground',
        'data-[range-start=true]:rounded-r-none data-[range-start=true]:bg-primary data-[range-start=true]:text-primary-foreground',
        'data-[range-start=true]:hover:bg-primary data-[range-start=true]:hover:text-primary-foreground',
        'data-[range-end=true]:rounded-l-none data-[range-end=true]:bg-primary data-[range-end=true]:text-primary-foreground',
        'data-[range-end=true]:hover:bg-primary data-[range-end=true]:hover:text-primary-foreground',
        'data-[range-middle=true]:rounded-none data-[range-middle=true]:bg-accent data-[range-middle=true]:text-accent-foreground',
        'data-[range-middle=true]:hover:bg-accent data-[range-middle=true]:hover:text-accent-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </Button>
  )
}

// WCAG 2.5.3 (Label in Name): a speech-input user says the number a day button shows, so the
// button's name has to contain that number as a word. react-day-picker names the button with the
// full date, and in English that writes the day as an ordinal ("Sunday, July 26th, 2026"), which
// doesn't contain "26". Where the label lacks the shown number, lead with it; a label that already
// has it, such as most translated ones from the `locale` prop, is kept as it is.
function nameWithShownDay(label: string | undefined, shown: React.ReactNode) {
  if (!label || typeof shown !== 'string' || !shown) return label
  const number = shown.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const asWord = new RegExp(`(^|[^\\p{L}\\p{N}])${number}($|[^\\p{L}\\p{N}])`, 'u')
  return asWord.test(label) ? label : `${shown}, ${label}`
}

export { Calendar }
