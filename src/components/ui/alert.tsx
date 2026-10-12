import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const alertVariants = cva(
  "relative grid w-full grid-cols-[0_1fr] items-start gap-x-3 gap-y-1 rounded-lg border px-4 py-3 text-sm has-[>svg]:grid-cols-[auto_1fr] [&>svg]:shrink-0 [&>svg]:translate-y-0.5 [&>svg]:text-current [&>svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground border-border',
        destructive: 'bg-destructive/10 text-foreground border-destructive/20 [&>svg]:text-destructive',
        success: 'bg-success/10 text-foreground border-success/20 [&>svg]:text-success',
        warning: 'bg-warning/10 text-foreground border-warning/20',
        info: 'bg-info/10 text-foreground border-info/20 [&>svg]:text-info',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant, className }))}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn('col-start-2 font-medium leading-tight tracking-tight', className)}
      {...props}
    />
  )
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        'text-muted-foreground col-start-2 grid gap-1 text-sm [&_p]:leading-relaxed',
        className,
      )}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, alertVariants }
