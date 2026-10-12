import * as React from 'react'
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react'
import type { VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'

function Pagination({ className, ...props }: React.ComponentProps<'nav'>) {
  return (
    <nav
      data-slot="pagination"
      aria-label="Pagination"
      className={cn('mx-auto flex w-full justify-center', className)}
      {...props}
    />
  )
}

function PaginationContent({ className, ...props }: React.ComponentProps<'ul'>) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn('flex flex-row items-center gap-1', className)}
      {...props}
    />
  )
}

function PaginationItem({ ...props }: React.ComponentProps<'li'>) {
  return <li data-slot="pagination-item" {...props} />
}

type PaginationLinkProps = {
  isActive?: boolean
} & Pick<VariantProps<typeof buttonVariants>, 'size'> &
  React.ComponentProps<'a'>

function PaginationLink({ className, isActive, size = 'icon', ...props }: PaginationLinkProps) {
  return (
    // eslint-disable-next-line jsx-a11y/anchor-has-content -- content (a page number, or an sr-only label + aria-label for Previous/Next) is supplied by consumers
    <a
      data-slot="pagination-link"
      data-active={isActive}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        buttonVariants({ variant: isActive ? 'outline' : 'ghost', size }),
        className,
      )}
      {...props}
    />
  )
}

function PaginationPrevious({ className, ...props }: React.ComponentProps<typeof PaginationLink>) {
  return (
    <PaginationLink
      aria-label="Go to previous page"
      size="md"
      className={cn('gap-1 px-2.5', className)}
      {...props}
    >
      <ChevronLeft />
      <span className="sr-only sm:not-sr-only">Previous</span>
    </PaginationLink>
  )
}

function PaginationNext({ className, ...props }: React.ComponentProps<typeof PaginationLink>) {
  return (
    <PaginationLink
      aria-label="Go to next page"
      size="md"
      className={cn('gap-1 px-2.5', className)}
      {...props}
    >
      <span className="sr-only sm:not-sr-only">Next</span>
      <ChevronRight />
    </PaginationLink>
  )
}

function PaginationEllipsis({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="pagination-ellipsis"
      aria-hidden
      className={cn('flex size-9 items-center justify-center', className)}
      {...props}
    >
      <MoreHorizontal className="size-4" />
      <span className="sr-only">More pages</span>
    </span>
  )
}

export {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
}
