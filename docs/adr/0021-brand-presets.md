# 0021. Brand presets fill the existing roles, are chosen at init, and leave the default neutral

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** the template maintainer (agreed with docs/changes/2026-11-14-plumb-preset.md)
- **Applies to:** `presets/<id>/`, `npm run init -- --preset <id>`, `src/styles/fonts.css`, and
  the brand guidance a preset adds to `docs/brand/`. It does not change what `process:apply`
  delivers.

## Context

A fork starts on the neutral Acme placeholder and has to settle two stakeholder decisions,
color strategy and display typeface, before it builds on the interface. The maintainer has
already settled both for his own projects in one design system, Plumb (a personal site, a
document-filling desktop tool and a scheduling application). Re-deriving it by hand in each fork
costs a day and drifts. Plumb's own roles (`canvas`, `ink`, `accent`, `pass`, `block`...) are
named differently from the template's 33 semantic roles (`background`, `foreground`, `primary`,
`success`, `destructive`...), which every component and story reads.

## Decision

We will ship brand presets as folders under `presets/<id>/` holding token sources
(`tokens/core/*.json`, `tokens/semantic/light.json` and `dark.json`), a `fonts.css`, optional
`brand/*.mdx` guidance and a README. A preset gives values to the template's existing roles and
never adds, renames or removes one, so components, stories and the contrast gate need no change.
`npm run init -- --preset <id>` copies a validated preset over the fork's sources and rebuilds the
generated output. The neutral placeholder stays the default, presets are fork-only like init
itself, and `process:apply` does not deliver them. Plumb is the first preset.

## Alternatives considered

### Alternative: give the preset its own role names

Copy Plumb's roles in as they are. It would have kept Plumb's vocabulary in forks that use it,
but every component reads the template's names, so it means renaming tokens or editing every
component per preset: a tier (c) change for each brand, which is what this decision avoids.

### Alternative: make Plumb the template's default

Replace the Acme placeholder. It would save the flag, but the placeholder is deliberately neutral
so forks for other clients don't inherit one person's brand, and `process:apply` targets aren't
the maintainer's.

### Alternative: ship the fonts as files inside the preset

Plumb itself ships woff2 files. That avoids three dependencies for forks that never use the
preset, but the template already self-hosts every face through Fontsource packages, so a second
mechanism would be a new convention to maintain. Unused packages cost install time, not bundle
weight, since only `src/styles/fonts.css` imports fonts.

## Consequences

- A fork can start on a settled brand in one command, and the contrast gate holds the preset's
  values to the same bar as the placeholder's.
- Each preset has to fit the template's role list. A brand that needs more roles (Plumb's
  high-contrast themes, its second accent, its densities, its editorial "paper" grounds) needs a
  separate, planned change that adds those roles for everyone.
- The template is public, so a preset publishes its brand's values and writing rules. A preset
  holds values and rules only: no names, contact details or product copy.
- Revisit when a second brand needs roles the template lacks, or when presets need to be applied
  to an existing fork rather than at init.
