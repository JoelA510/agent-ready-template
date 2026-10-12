import * as React from 'react'

import { cn } from '@/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground shadow-sm transition-colors resize-y placeholder:text-muted-foreground disabled:pointer-events-none disabled:opacity-50 outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:border-ring aria-invalid:ring-destructive/20 aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
