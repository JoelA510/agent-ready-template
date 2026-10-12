import * as React from 'react'
import { OTPInput, OTPInputContext } from 'input-otp'
import { Minus } from 'lucide-react'

import { cn } from '@/lib/utils'

// Codes arrive formatted ("123 456", "123-456"). With a `pattern`, input-otp rejects a paste that
// doesn't match, which forces the user to retype the code: the transcription step WCAG 2.2
// SC 3.3.8 (Accessible Authentication) asks forms not to require. Separators are stripped first.
const stripSeparators = (pasted: string) => pasted.replace(/[\s-]/g, '')

function InputOTP({
  className,
  containerClassName,
  pasteTransformer = stripSeparators,
  ...props
}: React.ComponentProps<typeof OTPInput> & {
  containerClassName?: string
}) {
  return (
    <OTPInput
      data-slot="input-otp"
      pasteTransformer={pasteTransformer}
      containerClassName={cn(
        'flex items-center gap-2 has-[:disabled]:opacity-50',
        containerClassName,
      )}
      className={cn('disabled:opacity-50', className)}
      {...props}
    />
  )
}

function InputOTPGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="input-otp-group"
      className={cn('flex items-center', className)}
      {...props}
    />
  )
}

function InputOTPSlot({
  index,
  className,
  ...props
}: React.ComponentProps<'div'> & { index: number }) {
  const inputOTPContext = React.useContext(OTPInputContext)
  const slot = inputOTPContext?.slots[index]
  const { char, hasFakeCaret, isActive } = slot ?? {}

  return (
    <div
      data-slot="input-otp-slot"
      data-active={isActive}
      className={cn(
        'relative flex h-9 w-9 items-center justify-center border-y border-r border-input text-sm text-foreground shadow-sm outline-none transition-all',
        'first:rounded-l-md first:border-l last:rounded-r-md',
        'data-[active=true]:z-10 data-[active=true]:border-ring data-[active=true]:ring-3 data-[active=true]:ring-ring',
        'aria-invalid:border-destructive data-[active=true]:aria-invalid:ring-destructive/20',
        className,
      )}
      {...props}
    >
      {char}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-4 w-px animate-caret-blink bg-foreground duration-1000" />
        </div>
      )}
    </div>
  )
}

function InputOTPSeparator({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="input-otp-separator"
      role="separator"
      className={cn('flex items-center text-muted-foreground', className)}
      {...props}
    >
      <Minus className="size-4" />
    </div>
  )
}

export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator }
