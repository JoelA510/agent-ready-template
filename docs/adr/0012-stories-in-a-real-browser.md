# 0012. Every story runs in a real browser, with axe as a gate

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** template maintainers
- **Applies to:** `npm run test:browser` and `vitest.browser.config.ts`,
  `.storybook/preview.tsx`'s `a11y` parameters, the exception register in
  `src/components/ui/stories.a11y.test.tsx`, CI's "Stories in a real browser" job, and the
  2.5.8 row of `docs/foundations/accessibility.mdx`. It carries out what
  [0009](./0009-wcag-2-2-aa.md) left as a follow-up: target size gated, not measured once.

## Context

- **`axe` ran against every story only in jsdom,** which has no layout:
  - color contrast was held by `check-contrast` on the tokens, not by what the stories render;
  - WCAG 2.2's target size couldn't be measured at all.
- **ADR 0009 said so:** target size was measured once in a real browser, and the Storybook
  panel's axe run was advice (`a11y: { test: 'todo' }`).

Verified 2026-09-24:

- `@storybook/addon-vitest` runs each story as a Vitest test in browser mode (Playwright), with
  the a11y addon's axe check after it renders; `a11y.test: 'error'` fails the run on a violation.
- axe-core 4.12's `target-size` rule is `enabled: false` by default (read in the axe-core
  source), so it has to be turned on.
- Storybook merges a story's parameters into the project's key by key for objects, but replaces
  arrays whole (`combineParameters`, executed): a story that set `a11y.config.rules` to turn one
  rule off would also drop the project's `target-size` entry.
- Since Storybook 10.3 the add-on applies the project's preview annotations itself; a
  hand-written setup file turns that off (the add-on logs as much).

## Decision

- **A separate Vitest config, `vitest.browser.config.ts`,** runs every story in headless
  Chromium: `npm run test:browser`, and a CI job of its own.
  - `vitest.config.ts` (`npm run test`, `npm run check`) never loads Storybook or needs a
    browser. With the browser project in the same config, every run, the script tests
    included, loaded Storybook's presets, and `test:watch` started Chromium.
  - Two projects, one per theme: `__STORYBOOK_THEME__` sets the preview's initial theme, so
    rendered contrast is measured in dark as well as light.
  - `pretest:browser` builds the tokens first, so a token edit is measured, not the last build.
  - The add-on is pinned to the installed Storybook version (10.5.3), and it isn't registered in
    `.storybook/main.ts`: nothing in the Storybook UI runs these tests, and the Accessibility
    panel runs axe with the same parameters on its own.
- **`a11y: { test: 'error' }` with `target-size` enabled** in `.storybook/preview.tsx`, as
  `options.rules` (an object, so a story's own rules merge into it rather than replace it).
- **Tailwind in the browser config's plugins.** The first run didn't have it: Tailwind is
  registered only in `vite.config.ts`, which Vitest doesn't read. Every story rendered without
  utility classes, so contrast and size checks passed or failed for reasons unrelated to the
  design system.
  - A canary story (`browser-tier.stories.tsx`, hidden from the sidebar) fails the run if the
    token CSS or Tailwind's classes aren't applied, or if a pass renders in the wrong theme.
    It was shown failing without Tailwind, and with the theme wiring broken.
- **Exceptions are counted in one place.** An exception to one rule lives on the story, as
  `parameters.a11y.options.rules`, with the reason beside it, and both tiers read it. The jsdom
  test lists every way a story's parameters turn a check down (the rule off, `test` other than
  `error`, `disable`, a narrowed context, `runOnly`, an array `config.rules`) and fails unless
  the list equals `REVIEWED_EXCEPTIONS`; it also fails if any story ends up without
  `target-size`. Command's empty listbox is the only exception.
- **A sandbox's own Chromium:** `PLAYWRIGHT_CHROMIUM_EXECUTABLE` overrides the browser
  Playwright launches (validated: a path that doesn't exist fails the run). On Claude Code on
  the web, the SessionStart hook sets it from `$PLAYWRIGHT_BROWSERS_PATH`.

## Alternatives considered

### Alternative: the Storybook test runner against a built Storybook

The older `@storybook/test-runner` (Jest plus Playwright against a served build) works. It lost
because the Vitest add-on is Storybook's current direction, reuses this repo's Vitest setup, and
needs no server or separate build step.

### Alternative: fold the browser run into `npm run check`

One command. It lost because every contributor and agent would need a browser installed for the
basic gate. CI runs both, so a PR still can't merge with either red once CI is a required check.

### Alternative: pin Playwright to the version the local sandbox's Chromium expects

No override. It lost because that version (1.56) is seven minor versions behind current, and the
override is one optional environment variable.

## Consequences

- **Easier:** the first browser run found real defects the jsdom run couldn't, now fixed:
  - `ScrollArea`'s viewport scrolled but couldn't take focus. It's now a tab stop exactly when
    its content scrolls and holds nothing focusable, with an inset outline, and a play test
    tabs to it and checks the outline is drawn. That test caught the first fix drawing none:
    in Tailwind v4, `outline-none` leaves `outline-2` with no style;
  - a story's scrolling list couldn't be reached by keyboard;
  - a disabled `Slider` story dimmed its label to 3.4:1.
- **Harder:**
  - CI has a third job that installs Chromium (about a minute of tests, both themes, plus the
    install).
  - A story that needs an exception says why, in the story.
- **Not covered:** a menu's, dialog's, or popover's contents, unless a story renders them open;
  and the WCAG 2.2 criteria axe can't judge (dragging alternatives, focus not obscured,
  accessible authentication).
- **Revisit** when Storybook's Vitest add-on supports Vitest 5 (it declares Vitest 3 or 4 today),
  or if the browser job's time grows past what a PR can wait for.
