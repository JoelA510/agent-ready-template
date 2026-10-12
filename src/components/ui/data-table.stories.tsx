import type { ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ColumnDef } from '@tanstack/react-table'

import { Badge } from './badge'
import { DataTable, DataTableColumnHeader, type DataTableFeatures, type DataTableProps } from './data-table'

type InvoiceStatus = 'Paid' | 'Sent' | 'Pending' | 'Overdue' | 'Draft'

interface Invoice {
  invoice: string
  project: string
  customer: string
  status: InvoiceStatus
  hours: number
  amount: number
}

const statusVariant: Record<InvoiceStatus, ComponentProps<typeof Badge>['variant']> = {
  Paid: 'success',
  Sent: 'info',
  Pending: 'warning',
  Overdue: 'destructive',
  Draft: 'secondary',
}

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

const columns: ColumnDef<DataTableFeatures, Invoice>[] = [
  {
    accessorKey: 'invoice',
    header: 'Invoice',
    enableSorting: false,
    cell: ({ row }) => <span className="font-medium tabular-nums">{row.getValue('invoice')}</span>,
  },
  {
    accessorKey: 'project',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
  },
  {
    accessorKey: 'customer',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Customer" />,
  },
  {
    accessorKey: 'status',
    header: 'Status',
    enableSorting: false,
    cell: ({ row }) => {
      const status = row.getValue<InvoiceStatus>('status')
      return <Badge variant={statusVariant[status]}>{status}</Badge>
    },
  },
  {
    accessorKey: 'hours',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Hours" />,
    cell: ({ row }) => (
      <div className="text-right tabular-nums">{row.getValue<number>('hours').toFixed(1)}</div>
    ),
  },
  {
    accessorKey: 'amount',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" />,
    cell: ({ row }) => (
      <div className="text-right font-medium tabular-nums">
        {currency.format(row.getValue<number>('amount'))}
      </div>
    ),
  },
]

const invoices: Invoice[] = [
  { invoice: 'INV-2043', project: 'Website redesign', customer: 'Globex', status: 'Paid', hours: 42.5, amount: 21250 },
  { invoice: 'INV-2044', project: 'Mobile app launch', customer: 'Initech', status: 'Sent', hours: 18.0, amount: 9000 },
  { invoice: 'INV-2045', project: 'Data migration', customer: 'Umbrella Corp', status: 'Overdue', hours: 27.75, amount: 13875 },
  { invoice: 'INV-2046', project: 'CRM integration', customer: 'Soylent Corp', status: 'Pending', hours: 12.25, amount: 6125 },
  { invoice: 'INV-2047', project: 'Cloud migration', customer: 'Hooli', status: 'Paid', hours: 33.5, amount: 16750 },
  { invoice: 'INV-2048', project: 'Onboarding revamp', customer: 'Vandelay Industries', status: 'Draft', hours: 8.5, amount: 4250 },
  { invoice: 'INV-2049', project: 'Analytics dashboard', customer: 'Stark Industries', status: 'Sent', hours: 51.0, amount: 25500 },
  { invoice: 'INV-2050', project: 'API platform build', customer: 'Wayne Enterprises', status: 'Overdue', hours: 15.5, amount: 7750 },
  { invoice: 'INV-2051', project: 'Security audit', customer: 'Wonka Industries', status: 'Pending', hours: 22.0, amount: 11000 },
  { invoice: 'INV-2052', project: 'Billing system upgrade', customer: 'Massive Dynamic', status: 'Paid', hours: 19.25, amount: 9625 },
  { invoice: 'INV-2053', project: 'Marketing site refresh', customer: 'Cyberdyne Systems', status: 'Draft', hours: 6.0, amount: 3000 },
  { invoice: 'INV-2054', project: 'Payment gateway rollout', customer: 'Acme Inc.', status: 'Sent', hours: 14.75, amount: 7375 },
]

const meta: Meta<DataTableProps<Invoice>> = {
  title: 'Components/DataTable',
  component: DataTable,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A data grid that layers @tanstack/react-table’s headless sorting, global filtering, and pagination logic over the design system’s Table primitive, so it inherits the same styling automatically. This is the recommended pattern for any sortable / filterable / paginated grid — projects, orders, invoices, or any tabular records. Describe each row with a `ColumnDef<DataTableFeatures, Row>`, use `DataTableColumnHeader` in a column’s `header` to make it sortable, then pass `columns` and `data`. Reach for the raw Table primitive only for a purely static, presentational table.',
      },
    },
  },
} satisfies Meta<DataTableProps<Invoice>>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { columns, data: invoices },
}

export const WithoutSearch: Story = {
  name: 'Without search',
  args: { columns, data: invoices, searchable: false },
}

export const WithoutPagination: Story = {
  name: 'Without pagination',
  args: { columns, data: invoices, paginated: false },
}

export const SmallPageSize: Story = {
  name: 'Small page size',
  args: { columns, data: invoices, pageSize: 5 },
}

export const Empty: Story = {
  args: { columns, data: [] },
}
