import type { Meta, StoryObj } from '@storybook/react-vite'

import { Label } from './label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './select'

const meta = {
  title: 'Components/Select',
  component: Select,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A Radix-backed dropdown for choosing one value from a fixed list. Reach for Select when the options are a short, known set rendered off-screen until opened; for two to four always-visible options prefer RadioGroup, and for free text prefer Input. Compose it from SelectTrigger + SelectValue and SelectContent > SelectGroup > SelectLabel + SelectItem — the subcomponents keep keyboard navigation, positioning, and the highlighted/selected states consistent everywhere it is used.',
      },
    },
  },
} satisfies Meta<typeof Select>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Select>
      <SelectTrigger className="w-64" aria-label="Department">
        <SelectValue placeholder="Select a department" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Product</SelectLabel>
          <SelectItem value="engineering">Engineering</SelectItem>
          <SelectItem value="design">Design</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Operations</SelectLabel>
          <SelectItem value="sales">Sales</SelectItem>
          <SelectItem value="support">Support</SelectItem>
          <SelectItem value="finance">Finance</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  ),
}

export const Disabled: Story = {
  render: () => (
    <Select disabled>
      <SelectTrigger className="w-64" aria-label="Department">
        <SelectValue placeholder="Select a department" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Product</SelectLabel>
          <SelectItem value="engineering">Engineering</SelectItem>
          <SelectItem value="design">Design</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  ),
}

export const WithLabel: Story = {
  name: 'With label',
  render: () => (
    <div className="grid gap-1.5">
      <Label htmlFor="story-department">Department</Label>
      <Select>
        <SelectTrigger id="story-department" className="w-64">
          <SelectValue placeholder="Select a department" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Product</SelectLabel>
            <SelectItem value="engineering">Engineering</SelectItem>
            <SelectItem value="design">Design</SelectItem>
          </SelectGroup>
          <SelectSeparator />
          <SelectGroup>
            <SelectLabel>Operations</SelectLabel>
            <SelectItem value="sales">Sales</SelectItem>
            <SelectItem value="support">Support</SelectItem>
            <SelectItem value="finance">Finance</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  ),
}

export const Invalid: Story = {
  render: () => (
    <div className="grid gap-1.5">
      <Label htmlFor="story-department-invalid">Department</Label>
      <Select>
        <SelectTrigger id="story-department-invalid" className="w-64" aria-invalid="true">
          <SelectValue placeholder="Select a department" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Product</SelectLabel>
            <SelectItem value="engineering">Engineering</SelectItem>
            <SelectItem value="design">Design</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      <p className="text-sm text-destructive">Select a department to continue.</p>
    </div>
  ),
}
