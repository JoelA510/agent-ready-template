# Plumb preset

Plumb is a design system for editorial pages and dense tools: a muted teal accent, cool slate
neutrals, Public Sans, Plus Jakarta Sans and JetBrains Mono. This preset carries its values into a
fork of the template (ADR 0021):

```bash
npm run init -- --name "Client Inc." --slug clientinc --preset plumb
```

## What it changes

- `tokens/core/color.json`: the template's palette keys with Plumb hues (teal `brand`, blue
  `accent`, slate `neutral`, status ramps), plus `plumb.light.*` and `plumb.dark.*`, Plumb's exact
  role values.
- `tokens/core/typography.json`: the template's type scale, Plumb's three families.
- `tokens/semantic/light.json`, `dark.json`: the template's 33 roles, each pointing at a Plumb role.
  No role is added, renamed or removed.
- `src/styles/fonts.css`: the three Fontsource faces.
- `docs/brand/severity-and-figures.mdx`: Plumb's severity and figure rules.

In the template itself nothing imports these files or the three Fontsource packages until init
applies the preset, so `knip.json` ignores `presets/**` and those packages.

## Role mapping

| Template role | Plumb role |
| --- | --- |
| `background` | `canvas` |
| `foreground` and the other `*-foreground` text roles on neutral grounds | `ink` |
| `card`, `sidebar` | `surface` |
| `popover` | `raised` |
| `primary`, `sidebar-primary`, `ring`, `sidebar-ring` | `accent` |
| `primary-foreground`, `sidebar-primary-foreground` | `on-accent` |
| `secondary`, `muted` | `sunken` |
| `muted-foreground`, `info` | `ink-soft` |
| `info-foreground` | `canvas` |
| `accent` / `accent-foreground` | `accent-soft` / `accent-ink` |
| `sidebar-accent` | `hover` |
| `border`, `sidebar-border` | `line` |
| `input` | `border-control` |
| `destructive` / `destructive-foreground` | `block` / `on-block` |
| `success`, `warning` | `pass-ink`, `warn-ink` (the text-safe values: the template uses these roles as text) |
| `success-foreground`, `warning-foreground` | white or Plumb's near-black, whichever holds 4.5:1 |

`muted-foreground` maps to `ink-soft`, not Plumb's tertiary `ink-muted`: on the template's 10%
status tints over the light background, `ink-muted` measured 4.42 to 4.46:1, under the 4.5:1 bar.

## Not in this preset

Plumb's two high-contrast themes, its blue accent setting, its three densities and its warm
"paper" editorial grounds each need roles the template doesn't have yet. They are a separate,
planned change. The Plumb design system itself is a private reference for its owner; the values
here are the template's copy and the source of truth for forks.
