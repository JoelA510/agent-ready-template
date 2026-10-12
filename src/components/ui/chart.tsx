import * as React from 'react'
import * as RechartsPrimitive from 'recharts'

import { cn } from '@/lib/utils'

/**
 * THE REAL DESIGN DECISION in this file: when a `ChartContainer` config entry doesn't
 * specify its own color, what should a data series actually draw from?
 *
 * This sequence is a RECOMMENDED DEFAULT, not a verified/committed categorical palette.
 * It reuses six colors this system already has — the brand color, the secondary accent,
 * and four status tokens — rather than inventing new chart-specific hues, on the theory
 * that colors chosen to read as distinct status states will also read as distinct chart
 * series. That theory hasn't actually been checked: a real categorical palette needs
 * pairwise contrast/distinguishability testing under common color-vision deficiencies
 * (deuteranopia and protanopia especially, since red/green and olive/brown confusions are
 * exactly the kind of thing "muted olive vs. muted status colors" could run into) before a
 * team leans on color alone to separate more than two or three series on a chart. That
 * verification is the specific follow-up this recommendation is waiting on — until it's
 * done, treat this as a reasonable starting point, not an audited system.
 *
 * A config entry's own explicit `color` (or `theme.light`/`theme.dark`) always overrides
 * this sequence — see the fallback logic in `ChartStyle` below — so a consumer who has
 * already done that verification for their own palette is never stuck with this one.
 */
// These reference the always-present generated `:root` custom properties directly (the raw
// --palette-* / --color-* vars emitted by Style Dictionary into src/styles/tokens/*.css),
// NOT the Tailwind-namespaced --color-brand-600 etc. that only exist via globals.css's
// `@theme inline` block. The @theme-inline vars are tree-shaken unless a literal reference
// survives for the build scanner to see, which made an all-`--color-*` list quietly
// fragile: brand/accent/neutral would silently drop out of :root under a refactor that built
// these strings dynamically, while info/success/warning (real :root props) kept working.
// Sourcing every entry from the always-present layer removes that asymmetry.
const CHART_DEFAULT_COLORS = [
  'var(--palette-brand-600)',
  'var(--palette-accent-600)',
  'var(--color-info-600)',
  'var(--color-success-600)',
  'var(--color-warning-600)',
  'var(--palette-neutral-500)',
] as const

// Mirrors globals.css's class-based dark mode (`<html class="dark">`, see its
// `@custom-variant dark` comment) rather than only `prefers-color-scheme`, so a config's
// `theme.dark` color applies exactly when the rest of the system's dark mode is active.
const CHART_THEMES = { light: '', dark: '.dark' } as const

type ChartConfig = {
  [key: string]: {
    label?: React.ReactNode
    icon?: React.ComponentType
  } & (
    | { color?: string; theme?: never }
    | { color?: never; theme: Record<keyof typeof CHART_THEMES, string> }
  )
}

type ChartContextProps = {
  config: ChartConfig
}

const ChartContext = React.createContext<ChartContextProps | null>(null)

function useChart() {
  const context = React.useContext(ChartContext)

  if (!context) {
    throw new Error('useChart must be used within a <ChartContainer />')
  }

  return context
}

function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: React.ComponentProps<'div'> & {
  config: ChartConfig
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>['children']
}) {
  const reactId = React.useId()
  const chartId = `chart-${id ?? reactId.replace(/:/g, '')}`

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line]:stroke-border [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-none [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-sector]:outline-none [&_.recharts-surface]:outline-none",
          className,
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  )
}

function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const entries = Object.entries(config)

  if (!entries.length) {
    return null
  }

  const css = (Object.keys(CHART_THEMES) as Array<keyof typeof CHART_THEMES>)
    .map((theme) => {
      const declarations = entries
        .map(([key, itemConfig], index) => {
          // Explicit config color/theme always wins; the recommended default sequence
          // only fills in for a series the consumer hasn't given a color of its own.
          const fallback = CHART_DEFAULT_COLORS[index % CHART_DEFAULT_COLORS.length]
          const color = itemConfig.theme?.[theme] ?? itemConfig.color ?? fallback
          return `  --color-${key}: ${color};`
        })
        .join('\n')

      return `${CHART_THEMES[theme]} [data-chart=${id}] {\n${declarations}\n}`
    })
    .join('\n')

  return <style>{css}</style>
}

// Recharts' `Tooltip` doesn't render a stable wrapper element of its own to attach a
// data-slot to (it reads chart context and portals its content) — this is a naming-only
// alias so call sites can import everything from this file's "Chart*" family.
const ChartTooltip = RechartsPrimitive.Tooltip

type ChartTooltipContentProps = {
  active?: boolean
  payload?: ReadonlyArray<RechartsPrimitive.TooltipPayloadEntry>
  label?: React.ReactNode
  className?: string
  labelClassName?: string
  labelFormatter?: (
    label: React.ReactNode,
    payload: ReadonlyArray<RechartsPrimitive.TooltipPayloadEntry>,
  ) => React.ReactNode
  formatter?: (
    value: RechartsPrimitive.TooltipValueType,
    name: string | number,
    item: RechartsPrimitive.TooltipPayloadEntry,
    index: number,
    payload: ReadonlyArray<RechartsPrimitive.TooltipPayloadEntry>,
  ) => React.ReactNode
  color?: string
  indicator?: 'line' | 'dot' | 'dashed'
  hideLabel?: boolean
  hideIndicator?: boolean
  nameKey?: string
  labelKey?: string
}

// Recharts clones whatever element is passed to `<Tooltip content={...} />` and injects
// the live `active`/`payload`/`label`/etc. at render time (see recharts' `ContentType`),
// so every field below is optional even though Recharts always supplies several of them —
// that's what lets `<ChartTooltipContent indicator="line" />` be written with no props at
// the call site in a story.
function ChartTooltipContent(props: ChartTooltipContentProps) {
  const {
    active,
    payload,
    className,
    indicator = 'dot',
    hideLabel = false,
    hideIndicator = false,
    label,
    labelFormatter,
    labelClassName,
    formatter,
    color,
    nameKey,
    labelKey,
  } = props

  const { config } = useChart()

  const tooltipLabel = React.useMemo(() => {
    if (hideLabel || !payload || !payload.length) {
      return null
    }

    const [item] = payload
    const key = labelKey || `${item?.dataKey ?? item?.name ?? 'value'}`
    const itemConfig = getPayloadConfigFromPayload(config, item, key)
    const value =
      !labelKey && typeof label === 'string' ? (config[label]?.label ?? label) : itemConfig?.label

    if (labelFormatter) {
      return <div className={cn('font-medium', labelClassName)}>{labelFormatter(value, payload)}</div>
    }

    if (!value) {
      return null
    }

    return <div className={cn('font-medium', labelClassName)}>{value}</div>
  }, [label, labelFormatter, payload, hideLabel, labelClassName, config, labelKey])

  if (!active || !payload || !payload.length) {
    return null
  }

  const nestLabel = payload.length === 1 && indicator !== 'dot'

  return (
    <div
      data-slot="chart-tooltip-content"
      className={cn(
        'grid min-w-40 items-start gap-1.5 rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md',
        className,
      )}
    >
      {!nestLabel ? tooltipLabel : null}
      <div className="grid gap-1.5">
        {payload.map((item, index) => {
          const key = nameKey || `${item.name ?? item.dataKey ?? 'value'}`
          const itemConfig = getPayloadConfigFromPayload(config, item, key)
          const indicatorColor = color || item.payload?.fill || item.color

          return (
            <div
              key={`${item.dataKey ?? item.name ?? index}`}
              className={cn(
                'flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-muted-foreground',
                indicator === 'dot' && 'items-center',
              )}
            >
              {formatter && item.value !== undefined && item.name ? (
                formatter(item.value, item.name, item, index, payload)
              ) : (
                <>
                  {itemConfig?.icon ? (
                    <itemConfig.icon />
                  ) : (
                    !hideIndicator && (
                      <div
                        className={cn(
                          'shrink-0 rounded-[2px] border-(--indicator-color) bg-(--indicator-color)',
                          {
                            'h-2.5 w-2.5': indicator === 'dot',
                            'w-1': indicator === 'line',
                            'w-0 border-[1.5px] border-dashed bg-transparent': indicator === 'dashed',
                            'my-0.5': nestLabel && indicator === 'dashed',
                          },
                        )}
                        style={{ '--indicator-color': indicatorColor } as React.CSSProperties}
                      />
                    )
                  )}
                  <div
                    className={cn(
                      'flex flex-1 justify-between leading-none',
                      nestLabel ? 'items-end' : 'items-center',
                    )}
                  >
                    <div className="grid gap-1.5">
                      {nestLabel ? tooltipLabel : null}
                      <span className="text-muted-foreground">{itemConfig?.label ?? item.name}</span>
                    </div>
                    {item.value !== undefined && item.value !== null ? (
                      <span className="font-mono font-medium tabular-nums text-foreground">
                        {typeof item.value === 'number' ? item.value.toLocaleString() : item.value}
                      </span>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Same naming-only alias as ChartTooltip, above.
const ChartLegend = RechartsPrimitive.Legend

type ChartLegendContentProps = {
  className?: string
  payload?: ReadonlyArray<RechartsPrimitive.LegendPayload>
  verticalAlign?: 'top' | 'bottom' | 'middle'
  hideIcon?: boolean
  nameKey?: string
}

function ChartLegendContent(props: ChartLegendContentProps) {
  const { className, hideIcon = false, payload, verticalAlign = 'bottom', nameKey } = props

  const { config } = useChart()

  if (!payload || !payload.length) {
    return null
  }

  return (
    <div
      data-slot="chart-legend-content"
      className={cn(
        'flex items-center justify-center gap-4',
        verticalAlign === 'top' ? 'pb-3' : 'pt-3',
        className,
      )}
    >
      {payload.map((item, index) => {
        const key = nameKey || `${item.dataKey ?? item.value ?? 'value'}`
        const itemConfig = getPayloadConfigFromPayload(config, item, key)

        return (
          <div
            key={`${item.value ?? key}-${index}`}
            className="flex items-center gap-1.5 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:text-muted-foreground"
          >
            {itemConfig?.icon && !hideIcon ? (
              <itemConfig.icon />
            ) : (
              <div
                className="h-2 w-2 shrink-0 rounded-[2px] bg-(--indicator-color)"
                style={{ '--indicator-color': item.color } as React.CSSProperties}
              />
            )}
            {itemConfig?.label ?? item.value}
          </div>
        )
      })}
    </div>
  )
}

// Shared by ChartTooltipContent and ChartLegendContent: Recharts payload items carry a
// `dataKey`/`name` and (often) a nested raw-datum `payload`, and the config key a chart
// consumer used may show up on either — check both before falling back to the raw key.
function getPayloadConfigFromPayload(
  config: ChartConfig,
  payload: unknown,
  key: string,
): ChartConfig[string] | undefined {
  if (typeof payload !== 'object' || payload === null) {
    return undefined
  }

  const payloadRecord = payload as Record<string, unknown>
  const nestedPayload =
    'payload' in payloadRecord &&
    typeof payloadRecord.payload === 'object' &&
    payloadRecord.payload !== null
      ? (payloadRecord.payload as Record<string, unknown>)
      : undefined

  let configLabelKey = key

  if (typeof payloadRecord[key] === 'string') {
    configLabelKey = payloadRecord[key] as string
  } else if (nestedPayload && typeof nestedPayload[key] === 'string') {
    configLabelKey = nestedPayload[key] as string
  }

  return configLabelKey in config ? config[configLabelKey] : config[key]
}

export {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  ChartStyle,
  type ChartConfig,
}
