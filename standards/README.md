# Standards

The standards every repository built with this process is held to, one file per standard, each
with a stable ID. They're the deterministic half of the existing-project audit
(`prompts/existing-project.md`), written so a machine can score a repository against them in a
minute and so the same ID means the same thing in every repository's scorecard, audit, and plan.
The reasoning is in [ADR 0015](../docs/adr/0015-standards-catalog-and-conformance.md).

```bash
npm run check:conformance -- --root ../my-app          # one repository's scorecard
npm run check:settings -- --repo acme/my-app            # its GitHub settings, over the API
npm run fleet:report -- --fleet ../hub/fleet.json       # every repository in a fleet file
```

They run from a checkout of this template, against any repository on disk (or, for the settings,
on GitHub), the way `check:instructions` and `check:env` do. Nothing has to be installed in the
repository being checked. `process:apply` delivers the standards a repository is held to into its
`prompts/standards/` (`core`, plus each pack given with `--pack`), with a README written for that
side ([`templates/standards/README.md`](../templates/standards/README.md)), so its agents can read
them where they work.

## Packs

A pack is a directory here: a `README.md` that says when the pack applies, and one file per
standard. `core` applies to every repository. The others apply where their markers are found at
the repository root, or where the repository's config (below) or `--pack` says, including at a
path below the root (`--pack node@mobile-app`).

| Pack | Applies to |
| --- | --- |
| [`core`](./core/README.md) | Every repository |
| [`node`](./node/README.md) | A `package.json` |
| [`vite-spa`](./vite-spa/README.md) | A Vite app |
| [`supabase`](./supabase/README.md) | A Supabase project directory |
| [`python`](./python/README.md) | A Python project file, a requirements file, or a `.py` file at the root |
| [`expo`](./expo/README.md) | `expo` in the root `package.json` |
| [`tauri`](./tauri/README.md) | `src-tauri/tauri.conf.json` or `src-tauri/Tauri.toml`, or the Tauri CLI in the root `package.json` |
| [`godot`](./godot/README.md) | A `project.godot` |
| [`static-site`](./static-site/README.md) | A static host's config: `firebase.json`, `netlify.toml`, `_headers`, or `staticwebapp.config.json` |
| [`writing`](./writing/README.md) | A prose linter's config: Vale, markdownlint, or cspell |

An app below the root (`mobile-app/`, `client_godot/`) isn't detected; declare it with its path.

## A standard

`standards/<pack>/<name>.md`, with frontmatter:

```yaml
---
id: node.strict-types # <pack>.<name>, equal to the file's path
title: Types are strict, or checked as JavaScript # what a passing repository does, one line
severity: high # blocker | high | medium | low: the audit skeleton's definitions
enforcement: check # check: a probe in scripts/check-conformance.mjs; settings: scripts/check-settings.mjs; audit: a person
audit-area: 2 # the existing-project audit area it belongs to (1-12)
---
```

The body says what the standard requires, why, how to meet it, and, for a checked standard,
exactly what the probe reads and what it can't see. A probe that can't decide reports `skipped` or
`error`, never `pass`.

The ID is permanent. A standard whose meaning changes gets a new ID, and the old file is removed
in the same change, with a CHANGELOG entry saying what a repository has to do, because baselines
and waivers in every repository name it.

## Results

Each applicable standard gets one status in a run (per path, for a pack applied below the root):

| Status | Meaning | Fails the run |
| --- | --- | --- |
| `pass` | The probe looked and found the standard met. | No |
| `fail` | The probe found it unmet; the evidence says where. | Yes |
| `waived` | A failure covered by a current waiver in the repository's config. | No |
| `baseline` | A failure recorded when the repository adopted the standards. | No |
| `n/a` | It doesn't apply here (no migrations yet, a private repository's license), with why. | No |
| `skipped` | The probe needs an input it wasn't given, and names it. | No |
| `audit` | A person checks it, or, for a `settings` standard, `check:settings` does; `check:conformance` lists it and never scores it. | No |
| `error` | The probe couldn't run. A run with an error exits 2: couldn't check is never clean. | Exits 2 |

## The repository's config

A repository that has adopted the standards keeps `docs/standards/conformance.json` (or another
path, given with `--config`):

```json
{
  "visibility": "public",
  "packs": ["node", "vite-spa", { "pack": "supabase", "path": "backend" }],
  "baseline": { "recorded": "2026-10-07", "standards": ["core.license", "node.strict-types"] },
  "waivers": [
    {
      "standard": "core.security-policy",
      "reason": "Reports go to the account-wide policy in the owner's public .github repository.",
      "owner": "maintainer",
      "expires": "2026-12-31"
    }
  ]
}
```

Every field is optional.

- **`visibility`** decides `core.license`. `--visibility` overrides it; without either, that
  standard is `skipped`.
- **`packs`**, when present, is the list: detection only suggests, and a pack it finds that the
  list leaves out is reported. A pack below the root is `{ "pack", "path" }`, and its results are
  keyed `<id>@<path>`.
- **`baseline`** is how a repository adopts the standards without fixing everything first. Its
  failures don't fail the run; a new failure does. It only shrinks: `--write-baseline` records the
  current failures when there's no baseline yet, and afterwards only removes the ones that are
  fixed (pass or `n/a`) or no longer evaluated; one that's skipped or waived in this run stays. A baseline entry that passes fails the run until it's removed, so a fixed standard can't
  quietly regress.
- **`vocabulary`** names the lists a repository's own prose checker reads, for
  `writing.vocabulary-registered`:
  `{ "accept": ["tools/names.txt"], "reject": ["tools/retired.txt"] }`. A cspell or Vale run
  needs no entry: its lists are in its own config.
- **`waivers`** are for a failure that's acceptable for now, with a reason of at least 40
  characters, an owner, and an expiry no more than 90 days out, the same bar as the dependency
  audit's waivers (`docs/security/dependency-policy.md`). An expired waiver covers nothing, and a
  waiver for a standard that no longer fails is stale and fails the run.

## Adding or changing a standard

1. Write the file, in the pack it belongs to. A standard that names neither a gate nor a concrete
   audit question doesn't belong here. A check proven in one repository comes in through
   [`prompts/harvest.md`](../prompts/harvest.md) (the `harvest` skill), which starts by showing
   it fail in its source.
2. For `enforcement: check`, add its probe to `PROBES` in `scripts/check-conformance.mjs`, and a
   test in `scripts/__tests__/check-conformance.test.ts` that shows the probe failing on a planted
   defect and passing on the fix. For `enforcement: settings`, the same in
   `scripts/check-settings.mjs` (`SETTINGS`) and its test, against GitHub's documented responses.
   The catalog tests fail until the probe exists; the planted-defect test is for review to check.
3. Add a CHANGELOG entry: a new or stricter standard can fail a repository that passed yesterday,
   so say what a repository needs to do.

## The fleet file

`npm run fleet:report` reads a list of repositories, local paths or git URLs, and writes one
markdown report: a row per repository, then the failing standards with the repositories each one
fails in. [`fleet.example.json`](./fleet.example.json) has the shape. Keep the real one in a
private repository of its own: it names every repository you have.
[`templates/hub/`](../templates/hub/README.md) is the skeleton of that repository, with a weekly
workflow that scores the fleet, settings included (`--settings`), and keeps the report in a pinned
issue. The report's Process column says how many files a `process:apply` re-run would change in
each repository; `npm run fleet:update` (the hub's **Fleet update** workflow) proposes that re-run
to each one as a pull request.
