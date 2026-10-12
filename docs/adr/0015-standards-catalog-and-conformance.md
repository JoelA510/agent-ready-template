# 0015. Standards are a catalog with stable IDs, grouped in packs, and scored by a conformance check

- **Status:** Accepted
- **Date:** 2026-10-07
- **Deciders:** template maintainers
- **Applies to:** `standards/`, `scripts/check-conformance.mjs`, `scripts/fleet-report.mjs`, each
  repository's `docs/standards/conformance.json` (this one's included), and `check-env`'s
  `define-env` finding.

## Context

The template holds projects to a standard through prose: the definition of done, the operating
rules, and the existing-project prompt's twelve audit areas. Measured against the maintainer's own
twelve repositories on 2026-10-07:

- **The process had reached none of them.** No repository had an apply manifest or a
  `templateVersion`.
- **The audits that did happen weren't comparable.** One sibling repo's production-readiness audit
  invented its own areas and finding IDs (PB-, DS-, TG-), so its findings line up with no other
  run's, and nothing re-measures them later.
- **The same checks were hand-rolled in different shapes:** bundle budgets, migration guards,
  client-secret scans, a determinism grep, a UI/UX pass copied into three repositories that has
  since drifted apart.
- **The common failures were cheap to detect and invisible without a full audit.** Of the ten
  checked for them, none had a SECURITY.md, a PR template, a Dependabot config, or a runtime pin;
  three had no CI; five public ones had no LICENSE; five had test suites no gate ran.

Tools built for this (OpenSSF Scorecard, scientific-python's sp-repo-review, Backstage scorecards,
Agent OS's standards profiles) share one shape: a written standard with an ID, a checker that
scores a repository against it, and a way to see every repository at once.

## Decision

We will keep the deterministic half of the standards as a catalog, score repositories against it
with a check that runs from a template checkout, and report a whole fleet in one table.

- **Catalog:** `standards/<pack>/<name>.md`, one standard per file, with an ID that equals its
  path (`node.strict-types`), a severity on the audit skeleton's scale, the audit area it belongs
  to, and `enforcement: check` (a probe scores it) or `audit` (a person does; listed, never
  scored). IDs are permanent: a standard whose meaning changes gets a new ID.
- **Packs:** `core` applies to every repository. The first stack packs are `node`, `vite-spa`,
  `supabase`, and `python`, the stacks at least two of the maintainer's repositories share. A pack
  applies where its markers are found at the root, or where the repository's config or `--pack`
  declares it, optionally at a path below the root. A declared list replaces detection, and a
  detected pack it leaves out is reported.
- **Probes** live in `scripts/check-conformance.mjs`, one per checked standard. They read files
  and git, never the network. Two run this template's own checks as they ship
  (`check-instructions`, `check-env`), so there's one implementation of each rule. CI is read by
  tracing what `pull_request` workflows run, through `package.json` scripts, workspace calls, and
  the repository's own shell scripts, and a command counts only where its failure fails the run
  (not under `continue-on-error`, `if: false`, or `|| true`, and not as an argument to an install).
  A file the repository lists through a symlink that leads out of it is left out of every check's
  file list, so its content can't reach a report; a config a listed file names (a tsconfig
  `extends`) is still followed. The probes here read only the files git lists, so a gitignored
  file doesn't count; `check-env` still reads gitignored env files, on purpose, because a local
  build bundles them. A probe that can't decide says `skipped`
  or `error`; neither is a pass, and an error makes the run exit 2.
- **The repository owns its record:** `docs/standards/conformance.json` holds its visibility, its
  declared packs, a baseline, and waivers. A baseline lets a repository adopt the standards
  without fixing everything first: its failures don't fail the run, new ones do, and it only
  shrinks. Waivers meet the dependency audit's bar: a reason, an owner, an expiry within 90 days.
  An expired waiver covers nothing, and a waiver or baseline entry for a standard that no longer
  fails is stale and fails the run.
- **The fleet:** `fleet:report` scores every repository in a fleet file (local paths or git URLs)
  and writes one markdown report. The fleet file names every repository someone has, so it lives in
  their own private repository, not here; `standards/fleet.example.json` is the shape.
- **This repository adopts its own standards,** and meets them. Its first run failed one,
  `node.ci-runs-gate`: CI never ran the app's `build` script (`tsc -b && vite build`). `npm run check`
  now runs it, between lint and the Storybook build, and the baseline the first run recorded has
  shrunk to empty, the way a baseline is meant to.
- **`check-env` learns `define-env`:** a `vite.config.*` whose `define` copies a non-public
  variable into the bundle, the way Google AI Studio's scaffold does with `GEMINI_API_KEY`. The
  research found the check passed that pattern.

The first increment stops there. Not yet built, each its own change:

- `process:apply --pack`, which would deliver a pack's standards and skeletons into a repository,
  and a harvest command that copies a check proven in one repository back into a pack;
- the prompts and skeletons citing standard IDs throughout (the existing-project prompt's baseline
  now runs the check and cites a failing standard by its ID; its twelve-area findings don't cite
  IDs yet);
- a hub workflow that runs the fleet report on a schedule and posts it to a pinned issue, and a
  probe for repository settings over the GitHub API;
- packs for the stacks one repository each uses, with what each should check first:
  - **Expo/EAS:** fingerprint runtime policy; `eas update --environment`.
  - **Tauri:** updater-key custody; capabilities and CSP; `cargo deny`.
  - **Godot:** replay golden hashes across operating systems.
  - **Static sites:** verify-dist; link and HTML checks; host headers.
  - **Writing repositories:** markdownlint, cspell, and Vale vocabulary.
- the drift check and update propagation (the research record's item 3).

**Follow-up, 2026-10-07.** Built since: `process:apply --pack` and `--check`, with merge proposals
([ADR 0016](./0016-apply-delivers-standards-proposes-merges-checks-drift.md));
`check:settings`, with five `core.settings-*` standards (`enforcement: settings`) that
`check:conformance` lists and never scores; and the five packs, each script and probe with
planted-defect tests. Also the hub skeleton (`templates/hub/`, its workflow parsed and its
script tested, never run on GitHub), the harvest prompt and skill (template only), and the
audit, remediation-plan, and lessons skeletons and both project prompts citing IDs, which are
prose. The packs check what's listed above, with two differences. Expo's runtime version takes
any of Expo's policies, not only `fingerprint`, because Expo recommends `appVersion`. Godot's
replay hashes across operating systems depend on each game's own harness, so the pack's README
leaves them to the audit. And propagation is still a re-run of `process:apply` in each
repository: `--check` and the fleet report's Process column say which ones need it, but nothing
opens the pull requests.

**Follow-up, 2026-10-08.** The writing pack's "Vale vocabulary" is `writing.vocabulary-registered`:
the prose check reads an accept list and a reject list, through cspell's or Vale's config, or, for
a repository's own checker, through lists named in the config's new `vocabulary` field. The reject
list is required, because the dictionaries already pass common names (cspell 10.3.6 and Vale
3.24.0 pass *Denise*), so a retired name only fails from a reject list. The change before it
stopped `writing.prose-checks-in-ci` passing a run that checks nothing (`vale sync`, `cspell
--version`).

## Alternatives considered

### Alternative: keep the standards as prose in the audit prompt

It's what existed, and the existing-project audit already covers every area. It lost because an
audit is an expensive, occasional, agent-run judgment whose output doesn't line up across
repositories, and the failures above sat unnoticed in every repository between audits. The audit
stays for what needs judgment; this takes over what a script can decide in seconds.

### Alternative: adopt an existing scorer (OpenSSF Scorecard, sp-repo-review)

Both are maintained and well designed. Scorecard's checks are fixed and about supply-chain
security, its GitHub Action needs paid Advanced Security on a private repository, and it has
nothing to say about RLS, strict types, or an agent's instructions. sp-repo-review is the closest
shape, but it scores against the Scientific Python development guide, in Python. Borrowing the
shape and writing the probes here keeps one toolchain (Node, already required for the template's
checks) and one source of truth for the rules.

### Alternative: a probe module beside each standard file

`standards/<pack>/<name>.mjs` next to its `.md` would keep each rule's prose and code together. It
lost for now because most probes share the same machinery (workflow tracing, package lookups,
migration parsing), and one file keeps that machinery in one place with one test file. Revisit when
the packs outgrow a single script.

### Alternative: keep the baseline in the apply manifest

The manifest already records what the template delivered. It lost because the manifest is the
template's record, rewritten by every apply, while the baseline and waivers are the repository's
own decisions. A fork or a repository that never received the process also needs one.

## Consequences

- **Easier:**
  - Any repository can be scored in seconds, with no install in it; eleven of the maintainer's
    repositories took about ten seconds together.
  - A failing standard names its evidence, file and line where there is one.
  - A repository adopts the standards by recording a baseline, then shrinks it.
  - The audit's baseline now starts from a scorecard.
- **Harder:**
  - Probes are heuristics. SQL is read as text (a table created in a function body is invisible),
    CI is traced through scripts and shell files but not through code in other languages, and a
    reusable workflow from another repository can't be read. Each standard's file says what its
    probe can't see.
  - A new or stricter probe can fail a repository that passed yesterday, so a probe change is a
    CHANGELOG entry that says what a repository has to do.
  - Standard IDs are an API: baselines and waivers in every repository name them.
- **Revisit:**
  - When a pack's probes need a toolchain this template doesn't have (Rust for `cargo deny`, Godot
    for headless tests). A probe that only reads files stays here; one that has to run the stack
    belongs in that repository's CI, with the probe checking that it runs.
  - When the catalog outgrows one script.

## Verification

- `npm run check:conformance -- --root .` exits 0 on this repository, with an empty baseline. A test
  holds it there (`scripts/__tests__/check-conformance.test.ts`, "this repository").
- The catalog test fails on a checked standard without a probe, a probe without a standard, an ID
  that doesn't match its path, or malformed frontmatter.
- Every probe has a test that shows it failing on a planted defect and passing on the fix. When
  this was written, defects planted in the probes themselves (RLS always on, a baseline allowed to
  grow, expired waivers honored, workspace calls and shell scripts not followed, continue-on-error
  steps counted as run) each failed the suite.
- `fleet:report` was run on 2026-10-07 against eleven of the maintainer's repositories, cloned
  locally. It found a public table without row-level security in one of them, confirmed by reading
  its migrations.
