import type { Meta, StoryObj } from '@storybook/react-vite'
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from './chart'

const meta = {
  title: 'Components/Chart',
  component: ChartContainer,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A theming wrapper around Recharts, not a charting library of its own — you still import and compose Recharts\' `BarChart`/`LineChart`/`Bar`/`Line`/etc. directly. `ChartContainer` takes a `config` object mapping each data-series key to a `label` and an optional `color` (or `theme: { light, dark }`), then exposes those as scoped `--color-{key}` CSS custom properties so a series can pull its color from this system\'s tokens (`fill="var(--color-revenue)"`) instead of Recharts\' own default palette. `ChartTooltipContent` and `ChartLegendContent` read that same config to render a tooltip/legend styled like this system\'s popover and card surfaces. Reach for this any time you\'re charting real product data — revenue, active users, signups, the kind of dashboards Acme\'s own analytics app builds — rather than a one-off illustrative graphic. A series left without an explicit color in `config` falls back to a recommended six-color sequence built from existing tokens (brand, accent, and four status colors) — see the code comment on `CHART_DEFAULT_COLORS` in chart.tsx: that sequence has not been verified for colorblind-safe distinguishability and should be treated as a starting point, not an audited palette.',
      },
    },
  },
} satisfies Meta<typeof ChartContainer>

export default meta
type Story = StoryObj<typeof meta>

const usersData = [
  { month: 'Jan', newUsers: 612, returningUsers: 158 },
  { month: 'Feb', newUsers: 578, returningUsers: 142 },
  { month: 'Mar', newUsers: 645, returningUsers: 171 },
  { month: 'Apr', newUsers: 601, returningUsers: 149 },
  { month: 'May', newUsers: 634, returningUsers: 163 },
  { month: 'Jun', newUsers: 589, returningUsers: 155 },
]

// No `color` set on either series here on purpose — this story is also the demonstration
// of ChartContainer's default color fallback (see CHART_DEFAULT_COLORS in chart.tsx).
// `label` alone is enough to exercise the config API.
const usersConfig = {
  newUsers: { label: 'New users' },
  returningUsers: { label: 'Returning users' },
} satisfies ChartConfig

export const Default: Story = {
  name: 'Bar chart — active users by month',
  args: { config: usersConfig, children: <div /> },
  render: () => (
    <ChartContainer config={usersConfig} className="h-80 w-full">
      <BarChart data={usersData}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={40} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="newUsers" fill="var(--color-newUsers)" radius={4} />
        <Bar dataKey="returningUsers" fill="var(--color-returningUsers)" radius={4} />
      </BarChart>
    </ChartContainer>
  ),
}

const revenueTrendData = [
  { month: 'Jan', revenue: 128400, netRevenue: 96200 },
  { month: 'Feb', revenue: 141850, netRevenue: 118300 },
  { month: 'Mar', revenue: 152900, netRevenue: 133750 },
  { month: 'Apr', revenue: 139600, netRevenue: 121400 },
  { month: 'May', revenue: 158300, netRevenue: 142950 },
  { month: 'Jun', revenue: 146700, netRevenue: 129800 },
]

// Explicit colors here, unlike the bar chart above — demonstrating that a config's own
// color always wins over the default fallback sequence.
const revenueTrendConfig = {
  revenue: { label: 'Revenue', color: 'var(--color-brand-700)' },
  netRevenue: { label: 'Net revenue', color: 'var(--color-accent-700)' },
} satisfies ChartConfig

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)

export const LineChartTrend: Story = {
  name: 'Line chart — monthly revenue trend',
  args: { config: revenueTrendConfig, children: <div /> },
  render: () => (
    <ChartContainer config={revenueTrendConfig} className="h-80 w-full">
      <LineChart data={revenueTrendData}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={64}
          tickFormatter={(value: number) => formatCurrency(value)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value, name) => (
                <div className="flex w-full items-center justify-between gap-3">
                  <span className="text-muted-foreground">{name}</span>
                  <span className="font-mono font-medium tabular-nums text-foreground">
                    {formatCurrency(Number(value))}
                  </span>
                </div>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Line
          type="monotone"
          dataKey="revenue"
          name="Revenue"
          stroke="var(--color-revenue)"
          strokeWidth={2}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="netRevenue"
          name="Net revenue"
          stroke="var(--color-netRevenue)"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ChartContainer>
  ),
}
