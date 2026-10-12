import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'

import { Button } from '@/components/ui/button'

describe('Button', () => {
  it('renders with its accessible name', () => {
    render(<Button>Save changes</Button>)

    const button = screen.getByRole('button', { name: 'Save changes' })
    expect(button).toBeInTheDocument()
  })

  it('applies the variant class for the destructive variant', () => {
    render(<Button variant="destructive">Delete</Button>)

    const button = screen.getByRole('button', { name: 'Delete' })
    expect(button).toHaveClass('bg-destructive')
  })

  it('fires onClick when clicked', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Click me</Button>)

    await user.click(screen.getByRole('button', { name: 'Click me' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not fire onClick when disabled', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <Button onClick={onClick} disabled>
        Click me
      </Button>,
    )

    await user.click(screen.getByRole('button', { name: 'Click me' }))

    expect(onClick).not.toHaveBeenCalled()
  })

  it('renders the child element when asChild is set', () => {
    render(
      <Button asChild>
        <a href="/home">Go home</a>
      </Button>,
    )

    const link = screen.getByRole('link', { name: 'Go home' })
    expect(link).toBeInTheDocument()
    expect(link.tagName).toBe('A')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('has no detectable accessibility violations', async () => {
    const { container } = render(<Button>Accessible label</Button>)

    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })
})
