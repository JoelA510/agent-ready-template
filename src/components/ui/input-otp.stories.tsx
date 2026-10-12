import type { Meta, StoryObj } from '@storybook/react-vite'
import { REGEXP_ONLY_DIGITS } from 'input-otp'

import { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } from './input-otp'
import { Label } from './label'

const meta = {
  title: 'Components/InputOTP',
  component: InputOTP,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A segmented one-time-code field built on `input-otp`: a single hidden input drives a row of individual character cells, each reading its own state (current character, active/caret) from the render context. Reach for it only for short fixed-length verification codes — email/SMS confirmation or an authenticator code — where seeing the digits land in discrete boxes reassures the user. It is not a general text input; for anything of variable length use `Input`. In the Acme dashboard this is only relevant if the product adds multi-factor authentication at sign-in; today it has none, so treat this as forward-looking. Constrain the input with a `pattern` (e.g. `REGEXP_ONLY_DIGITS`) so pasted or typed non-matching characters are rejected.',
      },
    },
  },
} satisfies Meta<typeof InputOTP>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  name: 'Six-digit code',
  args: { maxLength: 6, children: null },
  render: () => (
    <div className="grid gap-2">
      <Label htmlFor="otp-default">Verification code</Label>
      <InputOTP id="otp-default" maxLength={6} pattern={REGEXP_ONLY_DIGITS}>
        <InputOTPGroup>
          <InputOTPSlot index={0} />
          <InputOTPSlot index={1} />
          <InputOTPSlot index={2} />
          <InputOTPSlot index={3} />
          <InputOTPSlot index={4} />
          <InputOTPSlot index={5} />
        </InputOTPGroup>
      </InputOTP>
      <p className="text-sm text-muted-foreground">
        Enter the 6-digit code sent to your Acme email.
      </p>
    </div>
  ),
}

export const WithSeparator: Story = {
  name: 'Grouped 3 + 3 with separator',
  args: { maxLength: 6, children: null },
  render: () => (
    <div className="grid gap-2">
      <Label htmlFor="otp-grouped">Authenticator code</Label>
      <InputOTP id="otp-grouped" maxLength={6} pattern={REGEXP_ONLY_DIGITS}>
        <InputOTPGroup>
          <InputOTPSlot index={0} />
          <InputOTPSlot index={1} />
          <InputOTPSlot index={2} />
        </InputOTPGroup>
        <InputOTPSeparator />
        <InputOTPGroup>
          <InputOTPSlot index={3} />
          <InputOTPSlot index={4} />
          <InputOTPSlot index={5} />
        </InputOTPGroup>
      </InputOTP>
      <p className="text-sm text-muted-foreground">
        Enter the code from your authenticator app to confirm sign-in.
      </p>
    </div>
  ),
}
