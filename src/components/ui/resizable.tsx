import * as React from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { GripVertical } from 'lucide-react'

import { cn } from '@/lib/utils'

// react-resizable-panels v4 renamed the public API: the group is `Group` (not
// `PanelGroup`), the drag handle is `Separator` (not `PanelResizeHandle`), and the
// axis is set with `orientation="horizontal" | "vertical"` (not `direction`). These
// wrappers pass those props straight through, so callers use the native `orientation`
// prop on ResizablePanelGroup. The Separator emits `aria-orientation` on its own DOM
// node as the axis perpendicular to the group, which is what the handle styling below
// keys off of.

function ResizablePanelGroup({ className, ...props }: React.ComponentProps<typeof Group>) {
  return (
    <Group
      data-slot="resizable-panel-group"
      className={cn('flex h-full w-full', className)}
      {...props}
    />
  )
}

function ResizablePanel({ ...props }: React.ComponentProps<typeof Panel>) {
  return <Panel data-slot="resizable-panel" {...props} />
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof Separator> & {
  withHandle?: boolean
}) {
  return (
    <Separator
      data-slot="resizable-handle"
      className={cn(
        'group relative flex items-center justify-center bg-border outline-none',
        // Vertical divider line when the group is horizontal (aria-orientation=vertical).
        'aria-[orientation=vertical]:h-full aria-[orientation=vertical]:w-px',
        // Horizontal divider line when the group is vertical (aria-orientation=horizontal).
        'aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full',
        'focus-visible:ring-3 focus-visible:ring-ring focus-visible:border-ring',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      {withHandle && (
        <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border border-border bg-border text-foreground group-aria-[orientation=horizontal]:rotate-90">
          <GripVertical className="size-2.5" />
        </div>
      )}
    </Separator>
  )
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
