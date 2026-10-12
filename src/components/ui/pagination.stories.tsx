import type { Meta, StoryObj } from '@storybook/react-vite'
import type { MouseEvent } from 'react'

import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from './pagination'

const meta = {
  title: 'Components/Pagination',
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A composable set of plain (non-Radix) pieces for navigating a fixed, page-numbered list — reach for it on things like a company\'s projects, customers, or invoices list once a page of results is capped at a fixed size. It is not for open-ended feeds; use a "Load more" button or infinite scroll there instead. PaginationLink reuses `buttonVariants` from Button rather than redefining button styles, so page controls stay visually consistent with the rest of the system automatically.',
      },
    },
  },
} satisfies Meta<typeof Pagination>

export default meta
type Story = StoryObj<typeof meta>

const preventNavigation = (event: MouseEvent) => event.preventDefault()

export const Default: Story = {
  render: () => (
    <Pagination>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious href="#" onClick={preventNavigation} />
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#" onClick={preventNavigation}>
            1
          </PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#" isActive aria-label="Page 2, current page" onClick={preventNavigation}>
            2
          </PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#" onClick={preventNavigation}>
            3
          </PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationEllipsis />
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#" onClick={preventNavigation}>
            9
          </PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationNext href="#" onClick={preventNavigation} />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  ),
}
