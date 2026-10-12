import * as React from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export interface ComboboxOption {
  value: string
  label: string
}

interface ComboboxProps {
  options: ComboboxOption[]
  value?: string
  onValueChange?: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  className?: string
  disabled?: boolean
  id?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
}

/**
 * A searchable Select: the Popover + Command composition pattern, packaged as one
 * ready-to-use component for the common single-select case (see combobox.stories.tsx
 * for the API this optimizes for). Reach for it instead of Select once the option list
 * is long enough that typing to filter beats scrolling.
 */
function Combobox({
  options,
  value,
  onValueChange,
  placeholder = 'Select an option...',
  searchPlaceholder = 'Search...',
  emptyText = 'No results found.',
  className,
  disabled,
  id,
  ...props
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false)
  // The listbox the trigger controls — wired to aria-controls below so the combobox role
  // has its required relationship to the option list it opens.
  const listboxId = React.useId()

  const selectedOption = options.find((option) => option.value === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          data-slot="combobox-trigger"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          disabled={disabled}
          className={cn(
            'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors',
            selectedOption ? 'text-foreground' : 'text-muted-foreground',
            'outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:border-ring',
            'disabled:pointer-events-none disabled:opacity-50',
            'aria-invalid:ring-destructive/20 aria-invalid:border-destructive',
            className,
          )}
          {...props}
        >
          <span className="line-clamp-1">{selectedOption ? selectedOption.label : placeholder}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList id={listboxId}>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.label}
                  onSelect={() => {
                    onValueChange?.(option.value)
                    setOpen(false)
                  }}
                >
                  <Check
                    className={cn('size-4', option.value === value ? 'opacity-100' : 'opacity-0')}
                  />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export { Combobox }
