import { describe, it, expect } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { REGEXP_ONLY_DIGITS } from 'input-otp'

import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { Toaster, toast } from '@/components/ui/sonner'

// Behavior the WCAG 2.2 additions depend on that axe can't see (docs/foundations/accessibility.mdx).

describe('InputOTP: a pasted code is accepted as formatted (SC 3.3.8)', () => {
  const renderOtp = (pasteTransformer?: (pasted: string) => string) =>
    render(
      <InputOTP aria-label="Verification code" maxLength={6} pattern={REGEXP_ONLY_DIGITS} pasteTransformer={pasteTransformer}>
        <InputOTPGroup>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <InputOTPSlot key={i} index={i} />
          ))}
        </InputOTPGroup>
      </InputOTP>,
    )
  const paste = (text: string) => {
    const input = screen.getByRole('textbox', { name: 'Verification code' }) as HTMLInputElement
    input.focus()
    fireEvent.paste(input, { clipboardData: { getData: () => text } })
    return input
  }

  it.each(['123-456', '123 456', ' 123456 '])('accepts %j', (text) => {
    renderOtp()
    expect(paste(text).value).toBe('123456')
  })

  it("lets a caller replace the transformer, and input-otp's pattern still applies", () => {
    renderOtp((t) => t)
    expect(paste('123-456').value).toBe('')
  })
})

describe('Toaster: a toast can be dismissed without a swipe (SC 2.5.7)', () => {
  it('renders a close button by default', async () => {
    render(<Toaster />)
    act(() => {
      toast('Project created')
    })
    expect(await screen.findByRole('button', { name: /close/i })).toBeInTheDocument()
  })
})
