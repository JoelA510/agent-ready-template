# agent-ready-template

A reference repo for new and existing projects to use as a resource on the way to a completed,
production-grade state. It bundles two things that are usually kept apart:

1. **The process half** — the prompts, guardrails, and definition of done that take a codebase
   from "it runs on my machine" to something you'd hand to a paying user. These live in
   [`prompts/`](./prompts/) and in [`AGENTS.md`](./AGENTS.md), [`CONTRIBUTING.md`](./CONTRIBUTING.md),
   and [`docs/adr/`](./docs/adr/).
2. **The interface half** — a working, accessible front-end foundation you can build on
   immediately: design tokens compiled to every platform, React primitives built on Radix UI
   and Tailwind CSS v4, and written brand and content guidelines (voice, tone, terminology, UI
   copy) documented alongside them in one Storybook instance.

Both halves matter. Shipping fast on an ad-hoc interface produces a rewrite; shipping a
beautiful interface with no CI, no typed env, and no tests produces an outage. An accessible
button with the wrong words on it still fails a user, and well-written copy in an inaccessible
dialog fails them too.

The repo ships with a neutral placeholder identity (**Acme Inc.**) and a placeholder color <!-- init:keep -->
palette so every page renders and every component works out of the box. None of it is meant to
be kept as-is. Treat it as a menu of grounded recommendations to accept, adjust, or override,
decision by decision. Wherever there's a real choice to make (a primary color, a type pairing,
an ownership model), the docs name a recommendation, defend it, and name at least one genuine
alternative alongside it.

## Quick start

```bash
npm install
npm run storybook
```

Storybook opens at `http://localhost:6006`. It's the living documentation for the interface
half — every component's props and states, plus every Foundations, Components, and Brand &
Content page — and it's the place to look when you want to see something rather than read
about it.

## Pick your entry point

| Situation | Start here |
| --- | --- |
| Standing up a **new** project | [`prompts/new-project.md`](./prompts/new-project.md) — reference verification, stack selection, guardrail files, and a phased plan whose first milestone ends in a deployable walking skeleton. As a skill: `/bootstrap` (Claude Code, Antigravity), `$bootstrap` (Codex). |
| Taking an **existing** project to done | [`prompts/existing-project.md`](./prompts/existing-project.md) — a thirteen-area audit, a severity-ordered remediation plan, and execution milestones. Gap analysis, not a rewrite. As a skill: `/complete` (Claude Code, Antigravity), `$complete` (Codex). |
| Applying the process to a repo that **isn't a fork** | `npm run process:apply -- --target ../my-app` — delivers the prompts, the workflow skills, every artifact skeleton (staged under `prompts/skeletons/`, never at live paths), and the standards the repo is held to (`--pack <name>` adds a stack's); re-runs update only what the target hasn't edited, and `--check` says when it has drifted. See [`prompts/README.md`](./prompts/README.md#applying-this-to-a-project-that-isnt-a-fork). |
| Forking this repo as the base for the UI | [Make it yours](#make-it-yours) below. |
| Day-to-day work on a project that has the process | [`prompts/discovery.md`](./prompts/discovery.md), [`plan-change.md`](./prompts/plan-change.md), [`investigate.md`](./prompts/investigate.md), [`review.md`](./prompts/review.md), [`pre-pr.md`](./prompts/pre-pr.md), [`verify.md`](./prompts/verify.md) — a discovery pass before the next piece of work, a plan agreed before a large change, root-cause debugging, adversarial review, the pre-PR checklist, and the fast checks before each commit. As skills: `discovery`, `plan-change`, `root-cause`, `review-change`, `pre-pr`, `verify` (which Claude Code runs before each commit on its own). |
| Taking a template update into a project built from it | [`prompts/template-update.md`](./prompts/template-update.md) (the `template-update` skill), and [`docs/system/updating-from-the-template.mdx`](./docs/system/updating-from-the-template.mdx) — merge a release tag (a "Use this template" repo connects its history first, once), or re-run `process:apply` for a repo that received only the process. `npm run fleet:update -- --fleet <file> --apply` opens that update as a pull request in every repository of a fleet. |
| Measuring repositories against the standards | [`standards/README.md`](./standards/README.md) — `npm run check:conformance -- --root ../my-app` scores one repository against the catalog of standards (core plus a pack per stack), with a baseline for adopting them gradually; `npm run check:settings -- --repo <owner/name>` scores its GitHub settings; `npm run fleet:report -- --fleet <file>` scores all of yours in one table, and [`templates/hub/`](./templates/hub/README.md) runs that weekly. |
| Pulling only the components into an existing codebase | [`docs/system/consuming-in-an-existing-project.mdx`](./docs/system/consuming-in-an-existing-project.mdx) — read it before copying a single component; they depend on a substrate that has to be in place first. |

[`prompts/README.md`](./prompts/README.md) explains how the prompts are meant to be run and how
to record each run so the decisions behind a codebase stay recoverable.

## Make it yours

Rebranding is a short, ordered sequence. Do it once, up front, before you start adding your own
components:

1. **Replace the placeholder identity.** The init script handles the mechanical part in one
   pass. It replaces every `Acme`, `Acme Inc.`, and lowercase `acme` identifier across the repo, <!-- init:keep -->
   renames the npm package (in the lockfile too), retitles `index.html`, and regenerates the
   component registry under the new name, so the fork's first `npm run check:generated` is clean:

   ```bash
   node scripts/init.mjs --name "Client Inc." --slug clientinc --homepage https://design.client.example
   ```

   `--homepage` is where the deployed site serves `public/r/` (leave it off until you know). Run
   `node scripts/init.mjs` with no arguments to see every flag; bad arguments are rejected before
   anything is written. It leaves `CHANGELOG.md` (the template's history) alone, and any line
   marked `<!-- init:keep -->`, which is how the lines describing the placeholder stay true. It prints a "next steps" checklist when it's done, including a couple of
   doc references (the fictional analytics app the iconography and contributing pages lean on,
   and the terminology page's example vocabulary) that are domain-specific and need a human
   rewrite rather than a string swap. Then rewrite the
   Brand & Content pages under `docs/brand/` to describe *your* voice, tone, and terminology.
2. **Swap the palette for your brand ramp.** In `tokens/core/`, replace the placeholder
   `palette.brand.*` (primary) and `palette.accent.*` (secondary) color steps with your brand's
   ramps. The semantic tokens in `tokens/semantic/light.json` and `tokens/semantic/dark.json`
   already reference these by name, so re-pointing them is where most of a rebrand happens.
   Also swap `public/brand-mark.svg` for your own mark.
3. **Rebuild the tokens.**

   ```bash
   npm run tokens:build
   ```

   This compiles `tokens/**/*.json` into the generated CSS under `src/styles/tokens/` that the
   components consume, plus the JS/TS, iOS, and Android outputs under `platforms/` — see
   [Platform outputs](#platform-outputs).
4. **Work through the Storybook docs.** Open Storybook and read the Foundations and Brand &
   Content pages in order. Each one states a recommendation and at least one alternative; decide
   which fits your organization, adjust the docs to match, and delete the guidance that doesn't
   apply.
5. **Record the decisions you just made.** Add an ADR under [`docs/adr/`](./docs/adr/) for every
   consequential one. Six months from now, the reasoning is the part nobody can reconstruct.

Do **not** run the init script against an existing project; it's written for a fresh fork and
rewrites files repo-wide.

## Tech stack

- **React 19 + TypeScript** for components.
- **Vite** as the build tool and dev server.
- **Tailwind CSS v4**, configured CSS-first via `@theme` — no `tailwind.config.js`.
- **Radix UI** primitives underneath interactive components, for keyboard and screen-reader
  behavior that doesn't have to be rebuilt by hand.
- **class-variance-authority** for typed, constrained component variants.
- **Design tokens** authored as JSON in the
  [W3C Design Tokens Community Group](https://www.designtokens.org/) format and compiled by
  [Style Dictionary](https://styledictionary.com/) to CSS custom properties, plus typed JS/TS,
  JSON, iOS Swift, and Android XML — see [Platform outputs](#platform-outputs).
- **Storybook** (Vite builder), with the accessibility (`a11y`), `addon-docs`, `addon-themes`,
  `addon-links`, and `storybook-design-token` addons.
- **Vitest + Testing Library + axe** for component behavior and accessibility assertions, and
  **ESLint** (including `jsx-a11y`) with a pre-commit hook.

This is a deliberately mainstream, low-surprise stack: current, widely adopted, and easy to
hire for. If your organization already runs a similar front-end stack, this continues it rather
than introducing a second one to maintain.

The prompts in [`prompts/`](./prompts/) are stack-agnostic by design — they apply just as well
to a Python API or a native mobile app, and they require verifying every architectural
reference against its current state before borrowing from it.

## Platform outputs

`npm run tokens:build` compiles `tokens/**/*.json` into every consumer's format from one source
of truth, in one command:

| Output | Where | Consumed by |
| --- | --- | --- |
| CSS custom properties | `src/styles/tokens/` | This app (via `globals.css` / Tailwind's `@theme`). |
| Typed TS module + JSON | `platforms/js/` | React Native, other JS/TS apps, anything doing `matchMedia` against `breakpoint.*`. `tokens-core/light/dark` keep the web's CSS shapes. React Native takes easing, shadows, font families, line heights, and letter spacing from `tokens-native`: `Easing.bezier` control points, iOS shadow props plus an Android `elevation` and a `boxShadow` string, family names as an array, and point values per font size. |
| Swift | `platforms/ios/` | iOS apps. Colors as `UIColor`, dimensions as `CGFloat`, durations as `Double` seconds. Not compiled here — there is no iOS target in this repo, and no Swift toolchain was used to verify it beyond static well-formedness checks. |
| Android XML | `platforms/android/` | Android apps. Colors, `dp`/`sp` dimens, and millisecond durations as separate resource files. |

All four outputs are generated files — edit `tokens/**/*.json` and re-run `npm run tokens:build`,
never the generated files directly. Each generated file's header documents exactly which token
types it skips and why: Swift and Android XML leave out box-shadow strings and cubic-bezier
easing curves, which have no unambiguous native equivalent there. Colors may be authored as hex,
`rgb()`, `hsl()`, or `oklch()`, and the CSS keeps them as written. For JS, iOS, and Android:
- an `oklch()` color becomes the sRGB hex the contrast gate measured, gamut-mapped the way CSS
  Color 4 tells browsers to (Style Dictionary's own color transforms read `oklch()` as invalid
  and would have emitted black);
- every other format converts as it always has;
- a color nothing can read fails the build, before any generated file is touched
  ([ADR 0010](./docs/adr/0010-token-pipeline-colors-and-native-shapes.md)).

## Repository structure

| Path | What it is |
| --- | --- |
| `prompts/` | The build prompts — new-project bootstrap and existing-project audit — the day-to-day prompts (discovery, investigate, review, pre-PR, verify), the template-only harvest prompt, and the run log. Start here. |
| `templates/` | Skeletons for every artifact the prompts require in a target project (AGENTS.md and CLAUDE.md, ADRs, dev plan, audit, remediation plan, env contract), the standards README a target receives, and the fleet hub repository. |
| `AGENTS.md` | The rules every coding agent reads (Codex, Antigravity, Cursor, Copilot directly; Gemini CLI through `.gemini/settings.json`; Claude Code through `CLAUDE.md`'s import). |
| `.agents/skills/` | The workflow skills (`bootstrap`, `complete`, `discovery`, `plan-change`, `root-cause`, `review-change`, `pre-pr`, `verify`, `template-update`, and the template-only `harvest`) that run the prompts, in the Agent Skills format most agents read. `.claude/skills/` is the generated copy Claude Code reads. |
| `standards/` | The standards catalog: one file per standard, each with a stable ID, grouped into packs (`core` for every repository, then one per stack), and scored by `npm run check:conformance`. |
| `docs/adr/` | Architecture Decision Records. One per consequential choice; template included. |
| `docs/foundations/` | Foundations prose: color, type, spacing, motion, iconography, accessibility. |
| `docs/brand/` | Written brand and content guidance: voice and tone, grammar, terminology, UI copy patterns. |
| `docs/system/` | How the system is organized, how to contribute to it, how to consume it elsewhere. |
| `docs/proposals/` | Stakeholder-facing decision guides (generated HTML is gitignored). |
| `tokens/` | Source-of-truth design tokens (JSON) — core values and semantic (light/dark) aliases. Edit here. |
| `style-dictionary.config.mjs` | The build pipeline that compiles `tokens/` into CSS, JS/TS, JSON, Swift, and Android XML. |
| `platforms/` | Generated non-CSS token outputs — see [Platform outputs](#platform-outputs). Generated; don't hand-edit. |
| `src/styles/` | Generated token CSS plus `globals.css`, which wires tokens into Tailwind's theme. The `tokens/` subfolder is generated. |
| `src/components/ui/` | Component primitives (button, input, dialog, and so on), each with a Storybook stories file alongside it. |
| `src/lib/` | Shared utilities (class-name merging, etc.) used across components. |
| `scripts/` | The rebrand script, the contrast checker, the component registry builder, the process and standards tooling, the generated-file guard every agent's hooks run, and `setup.sh`, the one setup for people and cloud agents. |
| `evals/` | Regression evals for the skills, run on demand with `claude plugin eval` ([`evals/README.md`](./evals/README.md)). |
| `.storybook/` | Storybook configuration (addons, theming, preview setup). |
| `.github/` | CI, grouped dependency updates, and issue/PR templates. |

## Available scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs a minimal Vite preview app — a fast, Storybook-independent check that the token pipeline and components wire up end to end. |
| `npm run build` | Type-checks and builds the Vite app. |
| `npm run storybook` | Starts Storybook locally at `http://localhost:6006`. |
| `npm run build-storybook` | Builds static Storybook output, e.g. for hosting or review. |
| `npm run tokens:build` | Compiles `tokens/**/*.json` into every platform output (CSS, JS/TS, JSON, Swift, Android XML). Runs automatically before `dev` and `build`. |
| `npm run check` | The full gate: tokens build, contrast check, typecheck, lint, unused code (knip), the app build, the bundle budget, Storybook build, and tests. What CI runs. |
| `npm run check:audit` | Fails on any high or critical dependency advisory without a current, reasoned waiver (`docs/security/`). Runs in CI per PR and weekly. |
| `npm run check:generated` | Regenerates every generated output and fails if the committed copies differ (modified, orphaned, or new). It compares against the last commit, so it's not part of `check`: CI runs it on every PR, and you run it after committing a token or component change, before pushing. |
| `npm run check:conformance` | Scores a repository (`-- --root <path>`, default this one) against `standards/`, with its own baseline and waivers from `docs/standards/conformance.json`. `--write-baseline` records the current failures when adopting; afterwards it only shrinks. |
| `npm run check:settings -- --repo <owner/name>` | Scores a repository's GitHub settings over the API (workflow token, Dependabot, branch protection, private reporting, secret scanning). Needs a token that can read its admin settings in `GITHUB_TOKEN`. |
| `npm run fleet:report -- --fleet <file>` | Scores every repository in a fleet file (local paths or git URLs) and writes one markdown report, with each one's process drift; `--settings` adds its GitHub settings. |
| `npm run fleet:update -- --fleet <file>` | Proposes this template's process to every repository in a fleet file: a dry run, or with `--apply`, a `template/process-<commit>` branch and one pull request each where anything changed. |
| `npm run check:upgrade-path` | Proves a repository with the last release's process takes this commit's cleanly: nothing parked, nothing left over. CI runs it on every PR. A full clone with no release before `HEAD` (no `v*` tag, or tags only on `HEAD`) passes and says so. |
| `npm run check-contrast` | Recomputes WCAG contrast in both themes for the text/surface combinations the components render, plus focus rings at their drawn opacity; fails below AA, and fails when a color class in `src/components/` isn't measured by any pairing. Re-run after any palette change. |
| `npm run registry:build` | Regenerates the component registry (`registry.json` + `public/r/*.json`, and `public/llms.txt` for agents) from `src/components/ui/`. |
| `npm run init -- --name "..." --slug ...` | Rebrands a fresh fork — see [Make it yours](#make-it-yours). |
| `npm run process:apply -- --target <path>` | Delivers the prompts, skills, staged skeletons, and standards into another repo, with a manifest so re-runs are safe; never overwrites a file the target edited, and proposes a merge where both sides changed one. `--pack` adds a stack's standards, `--list` previews, `--check` reports drift. |
| `npm run test` | Vitest: component behavior plus `axe` accessibility checks across every story (jsdom). |
| `npm run test:browser` | Every story in real Chromium, in both themes, with `axe` and its play tests: rendered contrast and WCAG 2.2 target size. Needs `npx playwright install chromium` once. |
| `npm run lint` | Runs ESLint (including `jsx-a11y`, and Node rules for `scripts/`) across the repo; any warning fails it. |
| `npm run typecheck` | Runs the TypeScript compiler in no-emit mode. |

## Repository settings

A few things live in GitHub's settings rather than in a file. Do them once, in a new repo from
this template or in this one. On GitHub Free, rulesets, Pages, and code-owner review work only in
a public repository (a paid plan adds private ones), and private vulnerability reporting only in
a public one on any plan:

- **Make CI block merges.** Settings → Rules → Rulesets → New ruleset → Import a ruleset, and
  pick [`.github/rulesets/main.json`](./.github/rulesets/main.json). It requires every CI job
  on `main`, so a red run can't merge; until it's imported, CI only reports. GitHub enforces the
  imported copy, not the file: when a CI job is renamed or added, update the file (a test fails
  until you do) and import it again, or a required check nobody reports blocks every merge.
- **Publish Storybook and the component registry.** Settings → Pages → Source: GitHub Actions.
  [`pages.yml`](./.github/workflows/pages.yml) then deploys on every push to `main`. Set
  `package.json`'s `homepage` to the site's URL first (`https://<owner>.github.io/<repo>/`, or
  `init --homepage`) and run `npm run registry:build`: the workflow refuses to publish a
  registry built for another address.
- **Take vulnerability reports privately.** Settings → Advanced Security → Private vulnerability
  reporting → Enable. [`SECURITY.md`](./SECURITY.md) sends reporters there.
- **Dependabot** is configured in [`.github/dependabot.yml`](./.github/dependabot.yml); turn on
  its alerts and security updates in Settings → Advanced Security. If its version-update jobs
  queue and never run, check the runner it's set to use on the same page: a job waiting for a
  self-hosted or labeled runner that never comes is cancelled a day later, with no error
  anywhere else.

`npm run check:settings -- --repo <owner/name>` reports which of these are on (the ruleset as the
default branch requiring a status check), with a token that can read the repository's admin
settings.

## Where to go next

- **[`prompts/README.md`](./prompts/README.md)** — how to run the build prompts and log each run.
- **[`docs/system/introduction.mdx`](./docs/system/introduction.mdx)** (rendered in Storybook as
  **Introduction**) — how the interface half is organized and how to use it day to day.
- **[`CONTRIBUTING.md`](./CONTRIBUTING.md)** — the practical, step-by-step guide to making a
  change here, from local setup through what a pull request should include, ending with the
  definition of done a feature has to meet.
- **[`GOVERNANCE.md`](./GOVERNANCE.md)** — a recommended ownership, review, and versioning model
  your team can adopt and adjust.
- **[`AGENTS.md`](./AGENTS.md)** — the guide every coding agent reads (Claude Code through
  [`CLAUDE.md`](./CLAUDE.md)'s import): which situation you're in, the commands, conventions,
  and guardrails for working in this repo.

## Using this template

This is a starting point, not a finished product. The intended path is to **fork it** — once you
do, it becomes your project. Replace the placeholder identity and palette as described above,
then run the prompt that matches your situation. Template releases are tagged (`v1.0.0-rc.2` is
the first here); `init` records the one you started from as `templateVersion` in `package.json`, and
[Updating from the Template](./docs/system/updating-from-the-template.mdx) says how to take a
later one.

It's licensed under [MIT](./LICENSE). The UI primitives are derived from shadcn/ui, whose notice
is in [`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md). Adjust the license (or the ownership
terms in [`GOVERNANCE.md`](./GOVERNANCE.md)) if your organization needs something different.
