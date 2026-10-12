# 0004. Focus rings are drawn at full opacity

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** template maintainers
- **Applies to:** the shared focus pattern on every focusable component
  (`focus-visible:ring-3 focus-visible:ring-ring focus-visible:border-ring`), and
  `ring-sidebar-ring` in the sidebar

## Context

The components inherited shadcn's translucent focus halo, `focus-visible:ring-ring/50`. The
contrast gate measured the `ring` token solid (3.95:1 on the light page) and reported the focus
indicator as meeting SC 1.4.11. The ring actually drawn is `ring` at 50% over the page, which
is 1.82:1 in the light theme and 1.80:1 for the sidebar ring on the sidebar. That's well under
3:1. On borderless controls (`ghost` and `link` buttons, primary buttons) the ring is the only
focus indicator, so keyboard focus was close to invisible there.

## Decision

We will draw focus rings at full opacity: `focus-visible:ring-ring` and
`focus-visible:ring-sidebar-ring`, keeping the 3px width and `focus-visible:border-ring`.

## Alternatives considered

### Alternative: keep the `/50` halo and darken the `ring` token until it passes

At 50% alpha over `#fafaf9`, even pure black lands near 4:1. A ring dark enough to clear 3:1
at half opacity is a near-black brand shade, which gives up the reason for the halo: a soft,
brand-colored focus state. It would also make every fork's ring choice depend on a
compositing calculation nobody does by eye.

### Alternative: a second, offset outline behind the halo

This is the two-tone indicator pattern (`ring` plus `ring-offset`). It's robust on any
background, but it changes the visual language of every component more than this fix needs.
Forks remain free to adopt it; the gate measures whatever alpha they write.

## Consequences

- **Easier:** the focus state meets SC 1.4.11 in both themes with margin (3.81 to 4.13:1 light,
  7.83 to 9.29:1 dark). The gate now reads the alpha from the components, so a returning halo
  fails CI instead of passing unmeasured.
- **Harder / visible:** focus is a solid brand ring instead of a soft glow. Components copied
  out of this repo before this change keep the `/50`, and the CHANGELOG says to drop it.
- **Revisit if:** the palette changes so that a translucent ring clears 3:1, in which case
  `npm run check-contrast` passes it without any rule change here.

## Verification

`npm run check-contrast` prints one "(focus ring)" row per ring role, alpha, and surface the
components use, and fails below 3:1. `scripts/__tests__/check-contrast.test.ts` asserts that a
`focus-visible:ring-ring/50` probe fails in the light theme.
