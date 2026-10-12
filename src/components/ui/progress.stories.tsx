import type { Meta, StoryObj } from '@storybook/react-vite'

import { Progress } from './progress'

const meta = {
  title: 'Components/Progress',
  component: Progress,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "A determinate progress bar for a known completion percentage — a document upload, a multi-step project intake form, an export job. Radix's Progress primitive is determinate-only: it does not have an indeterminate/loading-spinner mode, so it can't represent a task where the duration isn't known. For that case (e.g. \"we're fetching this, but have no percentage to report\"), use Skeleton instead.",
      },
    },
  },
  argTypes: {
    value: { control: { type: 'range', min: 0, max: 100, step: 1 } },
  },
  args: {
    value: 60,
    // A progressbar needs an accessible name describing what's progressing. It's
    // context-specific, so the consumer supplies it (here, a representative example);
    // the component forwards aria-* straight to the Radix root.
    'aria-label': 'Document upload progress',
  },
} satisfies Meta<typeof Progress>

export default meta
type Story = StoryObj<typeof meta>

export const Quarter: Story = {
  name: 'Value 25',
  args: { value: 25 },
  render: (args) => <Progress {...args} className="w-64" />,
}

export const MostlyDone: Story = {
  name: 'Value 60',
  args: { value: 60 },
  render: (args) => <Progress {...args} className="w-64" />,
}

export const Complete: Story = {
  name: 'Value 100',
  args: { value: 100 },
  render: (args) => <Progress {...args} className="w-64" />,
}
