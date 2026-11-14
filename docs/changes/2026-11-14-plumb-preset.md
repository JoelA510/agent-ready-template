# Plumb as an optional brand preset

Kind: FEATURE · Drawn up: 2026-11-14 · Owner: Joel Abraham · Status: DONE (agreed and built 2026-11-14)

## Why

A new project forked from this template starts on the neutral Acme placeholder and has to make
the two stakeholder decisions (color strategy, display typeface) before building on the
interface. For the owner's own projects those decisions are already made: Plumb, the owner's
unified design system (personal site, FormWaypoint, SquadLogic), defines the palette, the type
and the writing rules. A preset lets a new fork start on Plumb in one command instead of
re-deriving it, while every other fork keeps the neutral default. The template has no
docs/product.md; this plan serves the mission in AGENTS.md "What this is": new repos start from
a verified stack and a phased plan, with the interface half ready to build on.

## Behavior

- **Now:** `npm run init -- --name … --slug …` rebrands names only. Colors, type and fonts stay
  the Acme placeholder until someone edits `tokens/` by hand.
- **After:** `npm run init -- --name … --slug … --preset plumb` also replaces the token values
  and fonts with Plumb's, then rebuilds the tokens. Every component and story renders in Plumb's
  teal accent, slate neutrals, Public Sans, Plus Jakarta Sans and JetBrains Mono, light and dark.
  `docs/brand/` gains Plumb's severity and figure rules.
- **Unchanged:**
  - Without `--preset`, init writes exactly what it writes today.
  - The token names: the 33 semantic roles in `tokens/semantic/light.json` and `dark.json` keep
    their names. Components and stories are not edited.
  - The theme mechanism: class-based `.dark`, `ThemeProvider` and `ThemeToggle` API untouched.
  - `npm run check` passes on the template as shipped and on a fork made with the preset.
  - `process:apply` delivers the same files it does today. A preset is fork-only, like init.

## Out of scope

- Plumb's two high-contrast themes, its blue accent slot and its three densities. Each changes
  the theme provider's public API or adds roles, so each is a tier (c) or (b) change with its
  own plan and ADR. Tracked as a follow-up plan.
- Plumb's editorial `paper` roles (warm grounds for portfolio pages). They need new semantic
  roles, so they belong to the follow-up plan.
- Plumb's component set. The template's Radix components stay; only their token values change.
- Making Plumb the default. Acme stays the default, so `process:apply` targets and other forks
  are unaffected.

## Against the rules

- AGENTS.md Golden rule 1 (generated files): follows. The preset writes token sources under
  `tokens/` and init runs `npm run tokens:build`. It never writes `src/styles/tokens/` or
  `platforms/` directly.
- Golden rule 2 (semantic tokens): follows. Plumb values map onto the existing roles.
- Golden rule 3 (accessibility): follows. The preset must pass `check-contrast` in both themes.
  A failing pair is fixed by choosing Plumb's `-ink` text value for that role, never by
  disabling a check.
- "Stop and agree a plan first", tier (c) (renaming or removing a token): does not apply,
  because no token is renamed or removed. This plan is tier (b): new init option, new files.
- "Stop and agree a plan first", stakeholder decisions (color strategy, display typeface): the
  preset is the owner's answer to both for his own forks. Agreement on this plan is that
  decision. The neutral default keeps the decision open for everyone else.
- ADR 0001 (interface foundation): follows. Radix, Tailwind v4 and Style Dictionary unchanged.
- ADR 0003 (dark status roles), 0004 (solid focus ring), 0009 (WCAG 2.2 AA): follows. Plumb's
  focus ring is a solid 2px accent outline, 3:1 or better on every ground.
- ADR 0006/0016 (what `process:apply` delivers): follows. `presets/` is not added to the apply
  manifest.
- Dependencies (dependency policy, `.npmrc` release-age wait): adds three font packages,
  `@fontsource-variable/public-sans`, `@fontsource-variable/plus-jakarta-sans` and
  `@fontsource-variable/jetbrains-mono` (5.3.0, OFL). That matches the existing convention of
  self-hosting fonts through Fontsource packages. Flagged in the PR description.
- Refactor beyond the request (AGENTS.md "Minimal diffs"): one, flagged here for agreement.
  Moving the six font imports out of `src/styles/globals.css` into `src/styles/fonts.css` lets
  the preset swap one file instead of editing `globals.css` in place. Cost of not doing it: init
  must rewrite a block inside a large stylesheet by pattern, which breaks silently if that block
  is edited. Risk of doing it: none at runtime (same imports, same order).
- New ADR needed: `docs/adr/0021-brand-presets.md`, recording that presets exist, are
  fork-only, keep the default neutral, and map onto existing roles rather than adding names.

## Design

**Files.** One folder per preset, `presets/plumb/`:

- `tokens/core/color.json`: Plumb's palette as core colors (oklch and hex values exactly as in
  Plumb, copied in, not linked).
- `tokens/core/typography.json`: families (`sans` Public Sans, `serif` slot holds Plus Jakarta
  Sans as the display face, `mono` JetBrains Mono) and Plumb's sizes, weights and line heights
  where the template has a matching step.
- `tokens/semantic/light.json`, `dark.json`: the 33 roles, valued from Plumb (mapping below).
- `fonts.css`: the three Fontsource imports.
- `brand/plumb-rules.mdx`: Plumb's severity language (Blocking, Warning, Info, Passed), the
  figure rules (a figure the source doesn't state stays blank and flagged, never 0), and the
  data-freshness pattern. These rules hold for any product, so they read as additions to
  `docs/brand/`, not replacements.
- `README.md`: what the preset is and a link to the Plumb design system for reference. The link
  is private to the owner; the template's copy of the values is the source of truth.

**Role mapping** (template role ← Plumb role, the same in light and dark):

| Template role | Plumb role |
| --- | --- |
| background | canvas |
| foreground, card-foreground, popover-foreground, secondary-foreground, sidebar-foreground, sidebar-accent-foreground | ink |
| card, sidebar | surface |
| popover | raised |
| primary, sidebar-primary, ring, sidebar-ring | accent |
| primary-foreground, sidebar-primary-foreground | on-accent |
| secondary, muted | sunken |
| muted-foreground | ink-muted |
| accent | accent-soft |
| accent-foreground | accent-ink |
| sidebar-accent | hover |
| border, sidebar-border | line |
| input | border-control |
| destructive / destructive-foreground | block / on-block |
| success, warning | pass-ink, warn-ink (the text-safe values, because the template uses these roles as text) |
| success-foreground, warning-foreground | chosen per theme (white or Plumb near-black) to hold 4.5:1 |
| info / info-foreground | ink-soft / canvas (Plumb treats info as neutral, never as accent) |

**init.** `--preset <id>` accepts only ids that are folders under `presets/` (validated before
anything is written, like every other flag). It copies the preset's `tokens/` over `tokens/`,
its `fonts.css` over `src/styles/fonts.css` and its `brand/` into `docs/brand/`, then runs
`npm run tokens:build` and `npm run registry:build` as it already does. A missing or unknown
preset fails with the list of valid ids and writes nothing.

**Failure surfacing.** A preset is validated before anything is written: the id must be a folder
under `presets/`, the required files must exist, and its semantic role names must match the
fork's exactly. If `tokens:build` then fails, init exits non-zero with the build's error and says
the files are written but the tokens need rebuilding, as it already does for the registry.

**Accessibility.** Every pair `check-contrast` enforces is checked against the preset's values
in both themes (executed in a test, below). Plumb's values were computed to pass 4.5:1 for text
and 3:1 for borders and the focus ring, so no failure is expected; the test proves it.

## Risks and rollback

- **Risk:** a Plumb value fails a template contrast pair the Plumb checks didn't cover (for
  example `muted-foreground` on a 90% `primary` tint). — **watch:** the preset contrast test
  fails. — **if it happens:** pick the nearest Plumb text value that passes, note it in the
  preset README; never weaken the check.
- **Risk:** the template is public (MIT), so the preset publishes the owner's brand values and
  writing rules. — **watch:** review the preset folder for anything personal before merge (no
  names, contact details or portfolio copy; values and rules only). — **if it happens:** remove
  it before merge.
- **Risk:** three new dependencies for forks that never use the preset. — **watch:** bundle
  budget check (`check:bundle`). Fonts are imported only from `fonts.css`, so unused packages
  add install time, not bundle weight. — **if it happens:** move the font packages into the
  preset as files instead (Plumb ships the same woff2 files).
- **Rollback:** revert the PR. No data, no migration; forks made with the preset keep their
  copied values.

## Tasks

- [x] Draft ADR 0021 (brand presets) and agree it — proved by review (a decision record has no
  test).
- [x] Move the font imports from `globals.css` to `src/styles/fonts.css` (the flagged refactor)
  — proved by `npm run check` and `npm run test:browser` passing unchanged, and the Storybook
  font story rendering the same faces.
- [x] Add `presets/plumb/` tokens and the role mapping — proved by
  `scripts/__tests__/presets.test.ts` (every preset, not only Plumb): builds the tokens from the preset and asserts every
  pair in `check-contrast` passes in light and dark, and that the role names match
  `tokens/semantic/*.json` exactly (no role added or missing).
- [x] Planted defect for that test — proved by the same test failing when one preset value is
  swapped for a low-contrast one (shown once, then reverted).
- [x] Add `--preset` to `scripts/init.mjs` — proved by `scripts/__tests__/init.test.ts` cases:
  `--preset plumb` writes the preset's token values and `fonts.css`; an unknown id fails and
  writes nothing; no `--preset` produces byte-identical output to today (the Unchanged list).
- [x] Add the three Fontsource packages and `presets/plumb/fonts.css` — proved by
  `npm run check` in a preset fork (build, bundle budget 18.2 of 20 kB), and a manual check: the
  fork's built app served locally loads Public Sans, Plus Jakarta Sans and JetBrains Mono from its
  own origin in light and dark, with no external request and no console error. Manual because a
  browser test would need a second full build of a preset fork inside the suite on every run.
- [x] Add `presets/plumb/brand/severity-and-figures.mdx` and the preset README — proved by
  `npm run check:instructions` and the Storybook docs build.
- [x] Confirm `process:apply` does not deliver `presets/` — proved by
  `scripts/__tests__/apply-process.test.ts` asserting no `presets/` path in the manifest.
- [x] Document `--preset` in AGENTS.md's command table and `docs/system/agent-reference.md` —
  proved by `npm run check:instructions` (AGENTS.md stays within its size budget).

## Found during the work

- **`muted-foreground` maps to `ink-soft`, not `ink-muted`.** On the template's 10% status tints
  over the light background, `ink-muted` measured 4.42 to 4.46:1. The gate caught it; the
  mapping changed, the check did not. `ink-soft` is also the closer meaning (secondary text).
- **A top-level `$description` in a preset's `core/color.json` collides** with the semantic
  files' in Style Dictionary. Caught by the init test; the note lives on the `plumb` group.
- **knip flips in a preset fork:** the placeholder's font packages become unused and the
  preset's become used. init now rewrites `knip.json`'s ignored font packages from what
  `src/styles/fonts.css` imports. Tested by running knip in the preset fork.
- **Vite inlined two small font subsets as base64,** adding about 5 kB gzipped to the CSS and
  failing the bundle budget in the preset fork. `vite.config.ts` now never inlines a font file;
  the template's own CSS is unchanged at 17.5 kB, the preset fork's is 18.2 kB.
- **Control borders on the popover (Codex review, PR #45):** in dark, Plumb's `border-control`
  (`#636a72`, the preset's `input`) measured 2.75:1 on the popover's raised surface; it had been
  fitted to the page, card and sunken grounds only. Now `#6c747b` (3.17:1 on raised, 3.51:1 on
  card). The contrast gate treats control borders as advisory, so `presets.test.ts` now holds
  every preset's `input` to 3:1 on background, card and popover; shown failing on the old value.
- **Resolved (agreed 2026-11-14):** 12 tests in `check-contrast.test.ts` and `tokens-build.test.ts`
  fail in a preset fork. They test the checker and the token build against the fork's live
  tokens and expect the placeholder palette's exact ratios and references. This predates the
  preset: at HEAD, a hand rebrand to a blue brand ramp that passes the contrast gate fails 3 of
  them. Fix: those tests now run against a frozen copy of the placeholder tokens,
  `scripts/__tests__/fixtures/placeholder-tokens/`; the tests that check the fork's own tokens
  still read the live ones. The full gate now passes in a preset fork (1,271 passed, 4 skipped:
  the unbranded-only init cases) and in the template (1,275 passed).

## Done when

- [x] Every task's test passes, and the "Unchanged" list has a test each.
- [x] The repository's full gate passes, and every new check was shown failing first.
- [x] The README, AGENTS.md, `docs/system/agent-reference.md` and ADR 0021 are updated where
  this change moved them. (The template has no docs/product.md.)
