# Contributing

This is the practical, step-by-step guide to working in this repo. For who owns what and what
review a change needs before it ships, see [`GOVERNANCE.md`](./GOVERNANCE.md) — that page
covers the organizational model; this one covers what to actually type into a terminal. For the
build prompts that drive a project toward completion, see [`prompts/`](./prompts/); for the
record of decisions made along the way, [`docs/adr/`](./docs/adr/).

One framing note before you start: this template ships with very little locked in. Several
foundational choices — the primary color, the type pairing — are documented as a
recommendation with named alternatives, not a final ruling (see `docs/foundations/colors.mdx`
in Storybook for an example: "Option A" stated plainly, "Option B" named as a real
alternative, neither treated as sacred). Once your organization adopts the template, you'll
settle those decisions for yourselves. If a contribution touches one of those open decisions,
follow the same pattern in your PR description — state what you're proposing and why, and name
the alternative you considered — rather than treating either the old or new value as obviously
correct.

## 1. Local setup

```bash
npm install
npm run storybook
```

Storybook runs at `http://localhost:6006`. It's the living documentation for this
system — every component's props, states, and usage guidance, plus every Foundations and
Brand & Content page, all in one browsable place. When in doubt about whether something is
"done" or how it's supposed to look, Storybook is the source of truth, not a screenshot in a
chat thread.

There's also a minimal Vite preview app for a fast, Storybook-independent sanity check:

```bash
npm run dev
```

This opens a single page (`src/App.tsx`) rendering a handful of components against the live
token pipeline. It answers one question quickly — "did the token build and the component
actually wire up end-to-end?" — before you go hunting for a bug in Storybook configuration
instead of your actual change. It isn't a second design surface and it isn't where component
states get documented; that's Storybook's job.

## 2. Adding or changing a design token

Tokens are the only place a raw value should ever live. **Never hand-edit
`src/styles/tokens/*.css`** — those three files (`tokens-core.css`, `tokens-light.css`,
`tokens-dark.css`) are generated output, rewritten wholesale on every build, and any manual
edit will silently disappear the next time someone runs the build.

1. Edit the source of truth instead:
   - `tokens/core/*.json` for raw, context-free values — a specific hex, a spacing step, a
     radius, a shadow. These files use the W3C Design Tokens Community Group (DTCG) format:
     every token is an object with a `$value` and a `$type`, e.g.
     `{ "$value": "#5c5d4b", "$type": "color" }`.
   - `tokens/semantic/light.json` and `tokens/semantic/dark.json` for role tokens — what a
     token *means* (`primary`, `muted-foreground`, `border`) rather than what it literally is.
     A semantic token should alias a core token via `{group.token}` reference syntax rather
     than repeating a literal value:

     ```json
     "primary": { "$value": "{palette.brand.700}", "$type": "color" }
     ```

     This is what makes a theme swap a one-line change: `primary` can point at a different
     palette step, or the dark file can point the same semantic name at a different value,
     without touching a single component.
2. Regenerate the CSS:

   ```bash
   npm run tokens:build
   ```

   (`npm run tokens:watch` reruns this on every save while you iterate.) This executes
   `style-dictionary.config.mjs`, which reads everything under `tokens/**` and writes the
   three generated files under `src/styles/tokens/` plus the `platforms/` outputs.
   **Commit the regenerated files in the same change as the token edit.** Native and React
   Native consumers read the committed `platforms/` files, not your build, and CI's
   `npm run check:generated` step fails a PR whose committed outputs don't match its sources.
3. Confirm the change shows up where you expect, in Storybook (restart it if it was already
   running — token CSS isn't hot-reloaded the way component code is) or in the `npm run dev`
   preview.

**A naming detail worth understanding, not just copying:** raw palette tokens are exposed as
CSS custom properties named `--palette-*` (e.g. `--palette-brand-500`), while
`src/styles/globals.css` maps them into Tailwind's theme namespace under a *different* name,
`--color-*` (e.g. `--color-brand-500: var(--palette-brand-500);`). That's deliberate. Tailwind
v4's `@theme inline` block wires a custom property to a `var()` reference so the reference
stays live at runtime — which is exactly what lets a `.dark` class swap every semantic color
without rebuilding any utility class. But a CSS custom property can't reference itself
(`--color-brand-500: var(--color-brand-500);` is invalid per the CSS custom properties spec —
it just fails to resolve). Giving the raw value a distinct name sidesteps that problem
entirely rather than working around it. Keep the two-name pattern for any new palette ramp or
semantic role: a source name in the generated token CSS, and a separate `--color-*` name in
`globals.css`'s `@theme inline` block that points at it.

## 3. Adding a new component

Before writing anything, read `src/components/ui/button.tsx` and `src/components/ui/card.tsx`
in full. Nearly every convention this system expects is visible in those two files, and
matching them is most of the review — a component that reinvents its own patterns instead of
following theirs will bounce back for rework even if it works correctly.

1. **Match the file shape.** A single primary component export (plus sub-components for a
   compound pattern, the way `card.tsx` exports `Card`, `CardHeader`, `CardTitle`, and so on),
   a `data-slot="…"` attribute on the root element for stable styling/testing hooks, and
   variants expressed with `class-variance-authority` (`cva`) whenever the component has more
   than one visual variant or size — see `buttonVariants` in `button.tsx`.
2. **Use `cn()` for every className, no exceptions.** Import it from `src/lib/utils.ts`. It
   merges conditional classes via `clsx` and resolves conflicting Tailwind utilities via
   `tailwind-merge`, which is what lets a consumer override a default
   (`<Button className="px-8" />`) without fighting specificity. Never hand-concatenate class
   strings.
3. **Semantic tokens only.** Reach for `bg-primary`, `text-muted-foreground`, `border-border` —
   never a raw palette class (`bg-brand-700`) and never an arbitrary hex or pixel value in the
   className. This keeps every future retheme a token-only change instead of a
   grep-and-replace across every component.
4. **Accessibility comes from the primitive, not from you re-deriving it.** Where Radix has a
   primitive for what you're building (dialog, select, tabs, switch, tooltip, etc.), build on
   top of it rather than assembling raw `div`s with ARIA attributes by hand — Radix has already
   solved focus management, keyboard navigation, and screen-reader labeling for that pattern.
   Reserve plain HTML elements for genuinely simple, non-interactive cases (a card, a badge).
5. **Ship a stories file next to the component**, named `component-name.stories.tsx`, with
   `tags: ['autodocs']` in the meta export so Storybook generates its docs page automatically.
   Cover every meaningful state: each variant, each size, disabled, and any error/invalid state
   the component supports. `button.stories.tsx` shows the shape to follow — a `meta` object
   with `argTypes` and default `args`, one named story per state, plus "All variants"/
   "All sizes" overview stories for a fast visual diff.

   **A recurring TypeScript trap when a story uses a custom `render` function** (needed for
   any compound/composed component — Dialog, Select, Combobox, Chart, and others all do
   this): if the component has a *required* prop (`ChartContainer`'s `config`, `Combobox`'s
   `options`, `ToggleGroup`'s `type`), `StoryObj<typeof meta>` still requires `args` to
   satisfy that prop even though `render()` ignores `args` entirely and builds the example
   inline. `tsc` will fail with "Property 'x' is missing" until you add a minimal
   `args: { requiredProp: someValidValue }` alongside `render` — the value never actually
   gets used, it only needs to type-check. This has bitten three separate components already
   (`toggle-group.stories.tsx`, `chart.stories.tsx`, `combobox.stories.tsx`); look there for
   the fix in practice before re-deriving it.
6. **Meet the "what done looks like for a component" checklist** in Storybook's Introduction
   page: semantic tokens only, keyboard-operable and screen-reader-labeled, a story for every
   meaningful state, WCAG 2.2 AA at minimum (contrast, target size, a single-pointer
   alternative to dragging, focus never covered).

**A note for React Server Component consumers:** most interactive primitives here depend on
React hooks and context via Radix (`useState`, `useContext`, event handlers). If you consume
these components in a framework built on React Server Components — Next.js App Router, or any
similar RSC setup — any component using hooks must be a Client Component. If you import one of
these components directly into a Server Component tree, add `'use client'` as the first line of
the file doing the importing (or a thin wrapper around the primitive, if you want the boundary
drawn further out). Skipping this isn't a silent failure — it's a build error — but it's worth
flagging up front so nobody loses time chasing it.

## 4. Adding or changing brand/content guidance

Content is not a second-class citizen here — a change to `docs/brand/*.mdx` goes through
exactly the same pull request process as a code change. In the PR description, say plainly
what you're replacing and why: which existing guidance or example this supersedes, and the
reasoning (a real ambiguity a writer hit, a UI pattern the current guidance doesn't cover, a
correction). "Because I preferred it" isn't something a reviewer can evaluate; "the current
empty-state copy doesn't cover a zero-results-from-a-filter case, here's the gap and a proposed
line" is.

## 5. Before opening a PR

Run the gate locally — CI runs the same command, and a red CI run costs more of everyone's
time than catching it yourself would have:

```bash
npm run check
```

That's tokens build → contrast check → typecheck → lint → unused code (knip) → app build →
bundle budget → Storybook build → tests. CI adds three checks that need a browser, a committed tree, or the
network. Run them too, the last two after committing:

```bash
npm run test:browser      # every story in Chromium, light and dark, axe after each render
npm run check:generated   # committed generated files match their sources
npm run check:audit       # no unwaived high/critical dependency advisories
```

`test:browser` needs Chromium once: `npx playwright install chromium`. It's the only gate that
measures rendered contrast and WCAG 2.2 target size, so run it after any component, story, or
token change.

Beyond a clean run, confirm:

- Every new or changed component has stories covering its meaningful states (see step 3.5
  above) — a component missing a disabled-state story is incomplete even if the prop works.
- Any new copy follows `docs/brand/writing-principles.mdx` (plain language, active voice,
  sentence case for UI text, and the rest of that page's guidance).
- Any new test, validator, or gate was shown failing against the defect it guards before you
  trusted it (see the definition of done, below).

## 6. Review expectations

This template recommends a tiered review model that scales with what changed — see
[`GOVERNANCE.md`](./GOVERNANCE.md) (or the Governance page in Storybook) for the full
breakdown of who reviews tokens versus components versus content, and why. This file won't
duplicate it — go there for specifics.

## 7. Definition of done

Everything above covers a change to this repo. This section is the bar for a *feature* in any
project built from this template — it's the same standard the build prompts in
[`prompts/`](./prompts/) enforce, restated here so it's in front of whoever is opening the pull
request rather than buried in a prompt nobody reopens. The list is word-for-word the one in the
CONTRIBUTING skeleton that projects receive (`templates/project/CONTRIBUTING.md`) and in the
new-project prompt's Phase 4; `scripts/__tests__/process-docs.test.ts` fails if the three drift
apart, so change all three together.

A feature is done only when **all** of these are true:

<!-- definition-of-done:start -->

- **Types are strict and honest.** The project's agreed strictness (strict mode, or `checkJs`
  for a JavaScript codebase) holds and is never loosened to get green; raising it further is a
  flagged refactor, not a precondition. No escape-hatch types (`any` or equivalent) without an
  inline comment justifying the specific one.
- **Input is validated at every trust boundary** — user input, external API responses, and
  environment variables (through the typed env module, never raw access).
- **Failure modes are surfaced**, to the user or to a log with enough context to diagnose.
  No silent catches, no unhandled rejections, timeouts and retries on every external call, and
  no success reported for work that didn't happen.
- **Tests exist and pass:** unit coverage for the logic, at least one meaningful edge case
  (not a happy-path duplicate), and end-to-end coverage of the user-facing flow. A bug fix
  includes a test that reproduces the reported case and fails without the fix.
- **Checks prove they can fail.** A new test, validator, lint rule, or CI gate is shown failing
  against the defect it guards (a planted defect, or the fix reverted) before it's trusted. A
  check that enumerates things (a validator, a scanner, a list-driven suite) asserts it examined
  a nonzero number of them; skipped suites are reported rather than silent; an allow or
  exclusion list fails when an entry goes stale.
- **Authentication and authorization are enforced server-side**, with row-level or
  query-level tenancy checks anywhere data belongs to more than one user.
- **Data is handled carefully.** Migrations are reviewed, and each has a tested revert — or,
  where the change is destructive or the tooling is forward-only, a written and tested recovery
  path instead. Identifiers are stored as text where leading zeros or formatting matter; blank
  is distinguished from zero; display precision is kept separate from stored precision; each
  derived value is computed in one place; multi-step writes are wrapped in a transaction.
  Fixtures and the repo hold no real personal or customer data, and logs carry only the
  identifiers diagnosis needs (an ID, not a name or an email).
- **Observability is wired** — structured logs and error reporting, from the first milestone.
  The test: can you answer "what failed for user X yesterday?"
- **Accessibility basics hold** on all new UI, at WCAG 2.2 AA: labels, focus order, keyboard
  operability, focus never fully hidden behind sticky content, a single-pointer alternative to
  any drag, pointer targets at least 24px or spaced as if they were, and contrast at AA or
  better.
- **Docs are current:** README, `.env.example`, user-facing text that describes what a check or
  rule does, and an ADR if a consequential decision was made.
- **It's deployed to a preview or staging environment and smoke-tested** against what shipped
  (the deployed page, bundle, or build), not the config that produced it. Not "should work."

<!-- definition-of-done:end -->

The three things this list is designed to prevent are the three that reliably get deferred:
testing, error handling, and accessibility. None of them belongs in a "later hardening"
milestone — by then the code that needed them is load-bearing and the deferral is permanent.

The "checks prove they can fail" item comes from two sibling projects. In one, 26 defects
reached `main` across three phases, every one a guarantee that passed its own tests: a
coverage check comparing a set against itself, a validator reporting a perfect score after
examining zero records. In the other, the regression tests against real data were skipped in
CI, because their fixtures were gitignored, while the CI file said they ran.

## 8. Releasing this template

Projects built from the template take updates from releases, not from `main`
([Updating from the Template](./docs/system/updating-from-the-template.mdx)), so a release is a
promise that the CHANGELOG tells them what to do.

1. **Every merged change has its CHANGELOG entry under the Unreleased heading**, written for the
   people who will take it: what changed, and what a project built from the template needs to
   do.
2. **Cut the release in a pull request.** Move the entries under
   `## [<version>] - <YYYY-MM-DD>`, lead with a short summary, and run
   `npm version <version> --no-git-tag-version` (it updates the lockfile too). Choose the version
   as [`GOVERNANCE.md`](./GOVERNANCE.md) §3 says: a major when taking the release breaks a
   project that doesn't act on it, a minor for additions, a patch for fixes. A test holds
   `package.json`, the lockfile, and the newest CHANGELOG release to the same version.
3. **Tag the release PR's merge commit** once CI is green on it: name the commit, since `HEAD`
   may be stale or already past it. `git fetch origin main`, then
   `git tag -a v<version> <merge-commit-sha> -m "v<version>"` and `git push origin v<version>`.
   Publish a GitHub release from the tag with the entry's text.
4. **Use a release candidate** (`1.0.0-rc.1`) when a change needs a trial on a real new or
   existing project before it's final. Record each trial in `prompts/run-log.md`.
