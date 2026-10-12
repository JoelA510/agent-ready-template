import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'

import { DataTable, DataTableColumnHeader, type DataTableFeatures } from '@/components/ui/data-table'

// What DataTable does for its user. Most of these name no TanStack type and passed on v8
// unchanged, so they prove a migration kept the behavior; the small-table sort holds what v9
// changed, and the column-helper test holds v9's typed columns.
const people = Array.from({ length: 12 }, (_, i) => ({
  name: ['Alice', 'Bob', 'Carol', 'Dan', 'Erin', 'Frank', 'Grace', 'Heidi', 'Ivan', 'Judy', 'Mallory', 'Niaj'][i],
  amount: [30, 10, 120, 50, 20, 90, 70, 40, 110, 60, 80, 100][i],
}))

function renderTable(props: { data?: typeof people; paginated?: boolean; pageSize?: number } = {}) {
  return render(
    <DataTable
      data={props.data ?? people}
      paginated={props.paginated}
      pageSize={props.pageSize}
      columns={[
        { accessorKey: 'name', header: 'Name', enableSorting: false },
        { accessorKey: 'amount', header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" /> },
      ]}
    />,
  )
}
const names = (container: HTMLElement) => [...container.querySelectorAll('tbody tr')].map((tr) => tr.querySelector('td')?.textContent)

describe('DataTable', () => {
  it('sorts a sortable column ascending, then descending, and shows which', async () => {
    const user = userEvent.setup()
    const { container } = renderTable({ paginated: false })
    expect(names(container).slice(0, 3)).toEqual(['Alice', 'Bob', 'Carol']) // as given
    const header = screen.getByRole('button', { name: 'Amount' })
    await user.click(header)
    expect(names(container).slice(0, 3)).toEqual(['Bob', 'Erin', 'Alice']) // 10, 20, 30
    expect(header.querySelector('.lucide-arrow-up')).not.toBeNull()
    await user.click(header)
    expect(names(container).slice(0, 3)).toEqual(['Carol', 'Ivan', 'Niaj']) // 120, 110, 100
    expect(header.querySelector('.lucide-arrow-down')).not.toBeNull()
  })

  it("renders a column that can't sort as its plain title", () => {
    renderTable()
    expect(screen.queryByRole('button', { name: 'Name' })).toBeNull()
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument()
  })

  it('narrows the rows to those matching the search, and restores them when it is cleared', async () => {
    const user = userEvent.setup()
    const { container } = renderTable({ paginated: false })
    const search = screen.getByRole('searchbox', { name: 'Search...' })
    await user.type(search, 'al')
    expect(names(container)).toEqual(['Alice', 'Mallory'])
    await user.clear(search)
    expect(names(container)).toHaveLength(12)
  })

  it('pages the rows, and disables Previous on the first page and Next on the last', async () => {
    const user = userEvent.setup()
    const { container } = renderTable({ pageSize: 5 })
    expect(names(container)).toEqual(['Alice', 'Bob', 'Carol', 'Dan', 'Erin'])
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument()
    expect(names(container)).toEqual(['Mallory', 'Niaj'])
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled()
  })

  it('shows every row and no page controls when it is not paginated', () => {
    const { container } = renderTable({ paginated: false })
    expect(names(container)).toHaveLength(12)
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
    expect(screen.queryByText(/^Page /)).toBeNull()
  })

  // A small table sorts text by TanStack v9's 'auto' choice (v8 sorted ten rows or fewer case-sensitively).
  it('sorts a text column with digits in numeric order and letters regardless of case', async () => {
    const user = userEvent.setup()
    const items = ['banana', 'Cherry', 'apple', 'Item 10', 'Item 2'].map((name) => ({ name }))
    const { container } = render(
      <DataTable data={items} columns={[{ accessorKey: 'name', header: ({ column }) => <DataTableColumnHeader column={column} title="Name" /> }]} />,
    )
    await user.click(screen.getByRole('button', { name: 'Name' }))
    expect(names(container)).toEqual(['apple', 'banana', 'Cherry', 'Item 2', 'Item 10'])
  })

  // Columns type as v9's useTable takes them: a column helper's list, through helper.columns,
  // keeps each column's value type; an inline column's value is unknown until it's named.
  it("takes a column helper's columns, and an inline column's value once it's named", () => {
    const helper = createColumnHelper<DataTableFeatures, (typeof people)[number]>()
    const columns = helper.columns([
      helper.accessor('name', { header: 'Name', cell: (info) => info.getValue().toUpperCase() }),
      helper.accessor('amount', { header: 'Amount', cell: (info) => info.getValue().toFixed(2) }),
    ])
    const { unmount } = render(<DataTable data={people} columns={columns} paginated={false} />)
    expect(screen.getByRole('row', { name: 'ALICE 30.00' })).toBeInTheDocument()
    unmount()
    render(
      <DataTable
        data={people}
        paginated={false}
        columns={[
          { accessorKey: 'name', header: 'Name' },
          // @ts-expect-error -- unknown until it's named, as on the next line
          { id: 'tenth', accessorKey: 'amount', header: 'Tenth', cell: (info) => info.getValue() / 10 },
          { accessorKey: 'amount', header: 'Amount', cell: (info) => info.getValue<number>().toFixed(2) },
        ]}
      />,
    )
    expect(screen.getByRole('row', { name: 'Alice 3 30.00' })).toBeInTheDocument()
  })

  it('takes a readonly column list, as useTable does', () => {
    const columns: ReadonlyArray<ColumnDef<DataTableFeatures, (typeof people)[number]>> = [{ accessorKey: 'name', header: 'Name' }]
    render(<DataTable data={[]} columns={columns} />)
    expect(screen.getByText('No results.')).toHaveAttribute('colspan', '1')
  })

  it('says "No results." across every column when there are no rows', () => {
    const { container } = renderTable({ data: [] })
    const cell = screen.getByText('No results.')
    expect(cell.tagName).toBe('TD')
    expect(cell).toHaveAttribute('colspan', '2')
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1)
  })
})
