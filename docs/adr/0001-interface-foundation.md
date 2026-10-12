# 0001. Own the interface foundation as source, with tokens as the single source of truth

- **Status:** Accepted
- **Date:** 2026-07-26
- **Deciders:** template maintainers
- **Applies to:** everything under `tokens/`, `src/`, `platforms/`, and the Storybook docs

## Context

This repo has to give a new or half-finished project a usable interface on day one without
becoming the thing the project later has to escape from. Two failure modes bracket the problem.
Start with nothing and every screen re-derives its own spacing, focus ring, and error copy;
by the time anyone notices, "fix the design" means touching every file. Start with a
batteries-included component library and the first genuinely custom requirement — a brand ramp
that doesn't fit its theming model, a dialog that needs different focus behavior — turns into a
fight with someone else's abstraction, usually resolved with overrides nobody can safely delete.

A further constraint: the projects this template serves aren't all web. Some grow a mobile
surface, and a color that exists only as a CSS custom property is a color that gets re-typed by
hand into Swift and XML, then drifts.

Accessibility is the third force. Keyboard interaction and screen-reader semantics for menus,
dialogs, comboboxes, and date pickers are genuinely hard to get right, cheap to get subtly
wrong, and invisible to the people approving the work.

## Decision

We will own the interface layer as source in this repo — React 19 + TypeScript primitives under
`src/components/ui/`, styled with Tailwind CSS v4 configured CSS-first via `@theme` — and treat
`tokens/**/*.json` (W3C DTCG format) as the single source of truth for every design value,
compiled by Style Dictionary into CSS custom properties, typed JS/TS, JSON, iOS Swift, and
Android XML. Interactive behavior comes from Radix UI primitives; variants come from
`class-variance-authority`; components reference semantic tokens only, never raw values.

## Alternatives considered

### Alternative: an off-the-shelf component library as a versioned dependency

Fastest possible start, upgrades arrive for free, and someone else owns the accessibility bug
reports. It lost on the exit cost. Rebranding through a theming API is fine until the brand
doesn't fit the API's shape, and at that point the escape hatch is per-component overrides that
accumulate faster than anyone removes them. Owning the source means a rebrand is a token change
and a genuinely custom component is just a file — at the price of owning upgrades ourselves,
which is a real cost we accept below.

### Alternative: hand-rolled interactive primitives instead of Radix

Fewer dependencies, complete control of the DOM. Rejected because the control isn't what's
scarce — correct focus trapping, typeahead, roving tabindex, and `aria-*` wiring are, and
re-deriving them per project produces components that pass a visual review and fail a screen
reader. Radix supplies behavior and leaves styling entirely to us, which is exactly the seam we
want. The cost is a dependency surface that has to be kept current.

### Alternative: CSS-in-JS or component-scoped stylesheets instead of Tailwind

Would keep styles co-located and avoid long className strings. Rejected mainly because of how
themes flip: Tailwind v4's `@theme inline` keeps custom-property references live at runtime, so
adding `.dark` re-points every semantic color without rebuilding a single utility class or
re-rendering through a theme provider. A runtime-styled approach reintroduces that machinery.
Long className strings are a real cost, mitigated by `cn()` and `cva` rather than denied.

### Alternative: define tokens directly in CSS and hand-port to other platforms

One less build step, and for a web-only project it would be defensible. Rejected because the
hand-port is where drift begins, and drift in a token is invisible until a designer notices two
products are subtly different colors. Generating every platform from one JSON source makes the
web and native outputs wrong together or right together.

## Consequences

Easier: rebranding (swap two palette ramps, rebuild), retheming light/dark (semantic aliases,
no component edits), adding a platform consumer (a new Style Dictionary target, not a new
spreadsheet of hexes), and shipping a custom component that behaves like the built-in ones.

Harder: we own upgrades. React, Tailwind, Radix, and Storybook majors are our problem, and
grouped weekly dependency updates plus the `npm run check` gate exist to keep that a routine
cost rather than an annual crisis. Generated output under `src/styles/tokens/` and `platforms/`
must never be hand-edited, which is a rule people break exactly once.

Locked in: components assume the substrate — Tailwind v4, the token CSS variables, the `@/`
alias, and `cn()`. Consuming them elsewhere means bringing that substrate along; see
`docs/system/consuming-in-an-existing-project.mdx`.

Revisit if: the project's interface needs diverge far enough from this component set that most
of it is unused, or a mobile surface becomes primary enough that a React Native component layer
(not just tokens) is warranted.

## Verification

- `npm run tokens:build` regenerates every platform output from `tokens/**/*.json`; a diff in
  generated files after a clean build means someone hand-edited output.
- `npm run check-contrast` recomputes WCAG contrast for every semantic pairing in both themes
  and fails below AA — the token-level guarantee that a palette swap didn't break legibility.
- `npm run check` runs tokens build, contrast, typecheck, lint (including `jsx-a11y`), the
  Storybook build, and Vitest with `axe` assertions across every story. CI runs the same
  command, so local and CI can't disagree.
