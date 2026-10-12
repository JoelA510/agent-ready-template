import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { Label } from './label'
import { Slider } from './slider'

const meta = {
  title: 'Components/Slider',
  component: Slider,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A Radix-backed track-and-thumb control for choosing a number, or a min/max range, within a continuous span — a usage target, a billing-amount filter, a date-range width. Reach for a Slider when the exact figure is less important than quickly landing in a neighborhood and seeing the value move; when the user needs to type a precise number (an invoice total, an hourly rate) prefer a numeric Input, and for a min/max where both bounds must be exact prefer a pair of Inputs over a two-thumb Slider. Pass a two-value array to render a range (Radix draws one thumb per value); a single-value array renders one thumb.',
      },
    },
  },
} satisfies Meta<typeof Slider>

export default meta
type Story = StoryObj<typeof meta>

function UsageTargetExample() {
  const [value, setValue] = React.useState([85])

  return (
    <div className="w-72 space-y-3">
      <div className="flex items-center justify-between">
        <Label>Usage target</Label>
        <span className="text-sm tabular-nums text-muted-foreground">{value[0]}%</span>
      </div>
      <Slider
        aria-label="Usage target percent"
        value={value}
        onValueChange={setValue}
        min={0}
        max={100}
        step={1}
      />
    </div>
  )
}

export const Default: Story = {
  name: 'Single value',
  render: () => <UsageTargetExample />,
}

function BillingRangeExample() {
  const [range, setRange] = React.useState([2000, 12000])
  const format = (n: number) => `$${n.toLocaleString('en-US')}`

  return (
    <div className="w-80 space-y-3">
      <div className="flex items-center justify-between">
        <Label>Invoice amount</Label>
        <span className="text-sm tabular-nums text-muted-foreground">
          {format(range[0])} &ndash; {format(range[1])}
        </span>
      </div>
      {/* Two thumbs each need their own accessible name — pass thumbLabels by index. */}
      <Slider
        thumbLabels={['Minimum invoice amount', 'Maximum invoice amount']}
        value={range}
        onValueChange={setRange}
        min={0}
        max={20000}
        step={500}
      />
    </div>
  )
}

export const Range: Story = {
  name: 'Range (min / max filter)',
  render: () => <BillingRangeExample />,
}

export const Disabled: Story = {
  render: () => (
    <div className="w-72 space-y-3">
      {/* The label stays readable: the dimmed slider already says it's disabled, and a label
          dimmed to 50% measures 3.4:1, under AA. WCAG exempts inactive components, but readable
          costs nothing. */}
      <Label>Usage target</Label>
      <Slider aria-label="Usage target percent" defaultValue={[85]} max={100} disabled />
    </div>
  ),
}
