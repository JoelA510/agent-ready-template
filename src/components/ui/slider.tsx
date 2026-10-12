import * as React from 'react'
import * as SliderPrimitive from '@radix-ui/react-slider'

import { cn } from '@/lib/utils'

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
  thumbLabels,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & {
  // Per-thumb accessible names, applied by index. A range slider has two thumbs that
  // each need their own name (e.g. ['Minimum', 'Maximum']) — a single aria-label can't
  // distinguish them. Falls back to aria-label when an index isn't provided.
  thumbLabels?: string[]
}) {
  // Radix renders one Thumb per value, so derive the thumb count from the
  // controlled `value`, the uncontrolled `defaultValue`, or fall back to the
  // single-range [min, max] default that Radix itself uses.
  const _values = React.useMemo(
    () =>
      Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : [min, max],
    [value, defaultValue, min, max],
  )

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        'relative flex w-full touch-none select-none items-center',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        'data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className={cn(
          'relative grow overflow-hidden rounded-full bg-muted',
          'data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full',
          'data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5',
        )}
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className={cn(
            'absolute bg-primary',
            'data-[orientation=horizontal]:h-full',
            'data-[orientation=vertical]:w-full',
          )}
        />
      </SliderPrimitive.Track>
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          aria-label={thumbLabels?.[index] ?? ariaLabel}
          aria-labelledby={thumbLabels ? undefined : ariaLabelledby}
          className={cn(
            'block size-4 shrink-0 rounded-full border border-primary bg-background shadow-sm transition-colors',
            'outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:border-ring',
            'disabled:pointer-events-none disabled:opacity-50',
          )}
        />
      ))}
    </SliderPrimitive.Root>
  )
}

export { Slider }
