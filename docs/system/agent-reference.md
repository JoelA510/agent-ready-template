# Agent reference

The reference detail behind [AGENTS.md](../../AGENTS.md): what each command checks, how the tokens
compile, the component recipe, the theme, the rebrand steps, and stakeholder visuals. The rules
stay in AGENTS.md, which every agent loads on every session; this page is read when the work
reaches one of these subjects. `npm run check:instructions -- docs/system/agent-reference.md`
holds its paths and scripts to the repository, as it does AGENTS.md's.

## Commands

| Command | What it does |
| --- | --- |
| `npm run check` | The gate: tokens build → contrast check → typecheck → lint → unused code → app build → bundle budget → Storybook build → tests. Run this before you consider a change done; CI also runs `test:browser` and `check:generated`. Before each commit (`verify`): `lint`, `typecheck`, `test`, and the build for any generated output whose source changed. |
| `npm run check:audit` | Dependency gate: fails on any high/critical `npm audit` advisory (runtime or dev) without a current waiver in `docs/security/audit-waivers.json`; expired or stale waivers fail too, and so does an audit of no dependencies. Runs in its own CI workflow per PR and weekly. Policy: `docs/security/dependency-policy.md`. |
| `npm run check:env` | Env checks for a target whose app reads environment variables (`-- --root <path>`; this repo's tooling reads only CI, token, and browser-path variables): a secret behind a client-exposed prefix (`VITE_`, `NEXT_PUBLIC_`, `EXPO_PUBLIC_`, …), an env read or Vite `define` that bundles more than it names, placeholder values, and `${VAR}` in `eas.json`; the full list heads `scripts/check-env.mjs`. It self-tests its detectors and exits 2 rather than pass when they fail. |
| `npm run check:instructions` | Lints agent instruction files and skills (CLAUDE.md, AGENTS.md, Cursor/Copilot/Gemini/Antigravity rules, `*/skills/*/SKILL.md`) for links, `@` imports, code-span paths, and `npm run` scripts that don't resolve; an AGENTS.md that Claude Code or Gemini CLI never reads; a skill that breaks the Agent Skills spec; an AGENTS.md over the strictest limit of the agents `.agents/platforms.json` selects (24,000 bytes without one; with Codex, a nested one also within what its ancestors leave of 32 KiB), and that file's own mistakes; and hidden characters (control, bidi, zero-width, variation selectors, Unicode tags). `-- --root <path>` checks another repo; file arguments check those files alone. Runs in `test` for this repo. |
| `npm run check:conformance` | Scores a repo (`-- --root <path>`) against the standards catalog in `standards/`: `core` plus the packs it detects or its `docs/standards/conformance.json` declares, with that file's baseline and expiring waivers. Exit 1 on a failure, 2 when a probe couldn't run. `npm run fleet:report -- --fleet <file>` scores every repo in a fleet file; `fleet:update` proposes this template's process to each, one PR apiece (`--apply`; a dry run without). Adding a standard: `standards/README.md`. |
| `npm run check:settings` | Scores a repo's GitHub settings over the API (`-- --repo <owner/name>`, with a token that can read its admin settings in `GITHUB_TOKEN`): the `settings` standards in `standards/core/`. `fleet:report -- --settings` adds them to the fleet table. |
| `npm run check:generated` | Drift gate: regenerates tokens, the registry, and the Claude Code skill copies, and fails if any committed generated file differs (modified, orphaned, or new). It compares against the last commit, so it's not part of `check`: CI runs it on every PR, and you run it after committing a token or component change, before pushing. |
| `npm run tokens:build` | Compiles `tokens/**/*.json` into every platform output (CSS, JS/TS, JSON, Swift, Android XML). |
| `npm run check-contrast` | Recomputes contrast from the tokens, both themes: every text pairing the components render (AA 4.5:1; the pairings are `TEXT_ON_SURFACE` in the script), and focus rings and status icons (3:1). Fails below either bar, or when a color class in `src/components/` isn't measured by any pairing. Re-run after any palette change. |
| `npm run registry:build` | Regenerates the shadcn registry (`registry.json` + `public/r/*.json`, each item with its source inlined, and `public/llms.txt`, its index for agents) from `src/components/ui/`, for the site at `package.json`'s `homepage`, where `.github/workflows/pages.yml` publishes it with Storybook. Each npm dependency is named with its major (`@tanstack/react-table@^9`). Run after adding/changing a component or a dependency's major; `test` fails until you do. |
| `npm run skills:build` | Regenerates `.claude/skills/` from `.agents/skills/`, validating each skill against the Agent Skills spec. Run after editing a skill. |
| `npm run storybook` | Living docs at `http://localhost:6006`. |
| `npm run dev` | Minimal Vite smoke-test app (`src/App.tsx`). |
| `npm run test` | Vitest, two projects: component behavior + `axe` a11y across every story (jsdom), and the Node tooling under `scripts/` (`scripts/__tests__/`). |
| `npm run test:browser` | Every story in real Chromium, once per theme, with `axe` after it renders (rendered color contrast and WCAG 2.2 target size, which jsdom can't measure) and the stories' play tests. Builds the tokens first; needs a browser (`npx playwright install chromium`). Run it after changing a component, story, or token. |
| `npm run check:unused` | knip: unused files, exports, and dependencies (`knip.json`; the components' exports are public API). |
| `npm run check:bundle` | The app build's gzipped JS and CSS against `bundle-budget.json`; raising a budget needs a stated reason. |
| `npm run lint` / `npm run typecheck` | ESLint (incl. `jsx-a11y`; Node rules for `scripts/` and root configs; zero warnings allowed) / `tsc -b --noEmit`. |
| `npm run init -- --name "Client Inc." --slug clientinc` | Rebrand a fresh fork (see "Rebrand workflow", below). |

## Token architecture

Source of truth is `tokens/**/*.json` in W3C DTCG format (`$value` / `$type`, with `{...}`
alias references):

- `tokens/core/*.json` — raw values: `palette.*` color ramps, `spacing`, `radius`, `shadow`,
  `motion`, `typography`, `breakpoint`, `z-index`.
- `tokens/semantic/{light,dark}.json` — role aliases (`primary`, `background`, `muted`,
  `destructive`, `sidebar-*`, …) that point at core values. Same role names in both files so
  components never branch on theme.

`style-dictionary.config.mjs` compiles those into:

- `src/styles/tokens/*.css` — CSS custom properties this app consumes (light = `:root`,
  dark = `.dark`). Wired into Tailwind v4 via `@theme inline` in `src/styles/globals.css`.
- `platforms/js/` — typed TS module + JSON (React Native, JS `matchMedia`, non-CSS web), plus
  `tokens-native` for the values React Native can't take in CSS form (easing, shadows, font
  families, line heights, letter spacing).
- `platforms/ios/` — Swift (`UIColor`, `CGFloat`, `Double` seconds).
- `platforms/android/` — XML resources (colors, `dp`/`sp` dimens, ms integers).

`npm run tokens:build` runs automatically before `dev`, `build`, and `storybook` via `pre*`
hooks, so you rarely call it directly — but do after editing any `tokens/**/*.json`.

## Adding or changing a component

Match the existing files in `src/components/ui/` exactly (read a couple first, e.g.
`button.tsx`, `card.tsx`). The pattern:

- One `*.tsx` per primitive, built on the matching Radix primitive where interactivity is
  involved (keyboard/focus/screen-reader behavior comes from Radix, don't hand-roll it).
- Variants via `class-variance-authority` (`cva`), using only semantic Tailwind classes.
- Merge incoming `className` with `cn()` from `@/lib/utils`.
- The shared focus-ring pattern on every focusable element:
  `outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:border-ring`. Where an
  ancestor's overflow would clip that outset ring (a scroll viewport), draw an inset outline, as
  `scroll-area.tsx` does; the browser tier's play tests are how you prove the indicator shows.
- Co-locate a `*.stories.tsx` covering every meaningful state (including disabled/error). The
  stories double as the usage examples — keep them realistic.
- UI primitives may co-export a `cva` variants fn (`export { Button, buttonVariants }`); the
  ESLint config already exempts `src/components/ui/**` from `react-refresh/only-export-components`.

`CONTRIBUTING.md` has the long-form version of this; `docs/` has the design reasoning.

## Theme (light/dark)

Class-based: `<html class="dark">` flips the dark tokens. `src/components/theme-provider.tsx`
(`ThemeProvider` + `useTheme`) is the opt-in runtime toggle — it respects
`prefers-color-scheme` on first load and persists the choice. It is not mounted by default;
wrap your app in it if you want a live switcher (`src/components/theme-toggle.tsx` is a ready
example).

## Rebrand workflow (fresh fork only)

1. `npm run init -- --name "Client Inc." --slug clientinc [--homepage <url>]` — swaps every
   `Acme` / `acme` reference, renames the package (lockfile too), retitles `index.html`, and <!-- init:keep -->
   regenerates the registry under the new name. It records the template release as
   `templateVersion` and restarts `version` at 0.1.0. It prints a checklist of the things it
   deliberately does NOT automate.
2. Swap `palette.brand.*` / `palette.accent.*` in `tokens/core/color.json`, then
   `npm run tokens:build`. Replace `public/brand-mark.svg`.
3. Rewrite `docs/brand/*` for the real voice/tone/terminology, and work through
   `docs/foundations/*` deciding each recommendation-vs-alternative.
4. Re-verify AA contrast for your new palette (see `docs/foundations/accessibility.mdx`).

## Visualizing decisions for stakeholder review

Some people who sign off on the decisions this system leaves open (the color **strategy**, the
display **typeface**, any "options menu, not a mandate" item in Foundations/Brand) don't read MDX.
When someone needs to review or choose between such options, default to a **visual decision
guide**: one self-contained HTML file rendering every option for real, in light and dark, with the
recommendation, the trade-offs, and the default if it's left to us. How to build one from the
docs, and how to hand it over (never auto-published: it carries the real brand), is in
`docs/proposals/README.md`.
