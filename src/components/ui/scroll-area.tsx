import * as React from 'react'
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'

import { cn } from '@/lib/utils'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable]:not([contenteditable="false"])'

// Whether the viewport has to be a tab stop itself: only when it scrolls and holds nothing a
// keyboard can reach, since focusing content inside already scrolls it into view (WCAG 2.1.1;
// axe's scrollable-region-focusable asks for exactly this). Re-evaluated as the viewport or its
// content resizes and as content changes, so a list that grows past the height gains the stop.
function useNeedsTabStop(ref: React.RefObject<HTMLDivElement | null>) {
  const [needs, setNeeds] = React.useState(false)
  React.useEffect(() => {
    const viewport = ref.current
    if (!viewport) return
    const update = () => {
      const scrolls =
        viewport.scrollHeight > viewport.clientHeight || viewport.scrollWidth > viewport.clientWidth
      setNeeds(scrolls && viewport.querySelector(FOCUSABLE) === null)
    }
    update()
    const resize = new ResizeObserver(update)
    resize.observe(viewport)
    if (viewport.firstElementChild) resize.observe(viewport.firstElementChild)
    const mutation = new MutationObserver(update)
    mutation.observe(viewport, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'tabindex', 'href', 'contenteditable'],
    })
    return () => {
      resize.disconnect()
      mutation.disconnect()
    }
  }, [ref])
  return needs
}

function ScrollArea({
  className,
  children,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  const viewport = React.useRef<HTMLDivElement>(null)
  const needsTabStop = useNeedsTabStop(viewport)
  const named = Boolean(ariaLabel || ariaLabelledBy)
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn('relative overflow-hidden', className)}
      {...props}
    >
      {/* The name goes on the viewport, the element that scrolls and takes focus, and makes it a
          region a screen reader can announce. The focus indicator is an inset outline: an outset
          ring would be clipped by the Root's overflow-hidden, and an outline paints over content
          that would cover an inset shadow. `outline-solid` is load-bearing: in Tailwind v4,
          `outline-none` sets the outline style to none, and `outline-2` alone doesn't restore it
          (the "Project list" story's play test fails without it). */}
      <ScrollAreaPrimitive.Viewport
        ref={viewport}
        data-slot="scroll-area-viewport"
        tabIndex={needsTabStop ? 0 : undefined}
        role={named ? 'region' : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className="size-full rounded-[inherit] outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner data-slot="scroll-area-corner" />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        'flex touch-none select-none p-px transition-colors',
        orientation === 'vertical' && 'h-full w-2.5 border-l border-l-transparent',
        orientation === 'horizontal' && 'h-2.5 flex-col border-t border-t-transparent',
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-border"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}

export { ScrollArea, ScrollBar }
