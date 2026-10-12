# 0019. Pin npm 11, and make npm wait for releases to age and refuse a dependency's git dependencies

- **Status:** Accepted
- **Date:** 2026-10-08
- **Deciders:** template maintainers (taken on the maintainer's go-ahead to adopt the candidates
  from the TanStack review)
- **Applies to:** `package.json` (`packageManager`, `allowScripts`), `.npmrc`, the dependency
  policy and its skeleton, and the `node.install-guards` standard

## Context

On 2026-05-11, 84 malicious versions of 42 `@tanstack/*` packages were published in six minutes
(TanStack's postmortem, GHSA-g7cv-rxg3-hmpx). A `pull_request_target` workflow built a fork's code
and saved a poisoned pnpm store to the Actions cache; the release workflow restored it and
published. The payload reached installs through a git `optionalDependencies` entry. The template
already pins actions by commit and audits its workflows (ADR 0017), and now keeps caches out of
publishing jobs (`core.workflow-caches`). Two install-side gaps were left:

- **Dependabot waits seven days; nothing else does.** `npm install some-package`, run by a person
  or an agent, takes a release published a minute ago. That's how most compromised versions reach
  a machine before they're pulled.
- **Any dependency can bring in a git dependency.** It skips the registry: no published version
  for anyone to pull, and no age to wait out.

npm 11 has a setting for each (verified against npm's config definitions and changelog, and run
here with npm 11.19.0):

- `min-release-age` (npm 11.10.0, 2026-02-11): days a version must have been published before npm
  chooses it. It applies when npm resolves (`npm install`, `npm update`), not to `npm ci`, which
  installs the lockfile as it is.
- `allow-git` (npm 11.9.0): `all`, `root` (only git dependencies `package.json` itself names), or
  `none`. Enforced when the package is fetched, so `npm ci` honors it too. npm 12 makes `none` the
  default.
- `allow-remote` (npm 11.14.0; 11.15.0 stopped `none` from blocking registry tarballs): the same
  for a dependency on a tarball URL. npm 12 makes `none` its default too.

The template pinned npm 10.9.9, which has neither. Node 24.21.0, the `.nvmrc` line's current
release, bundles npm 11.19.0; Node 22 bundles 10.9.9. The dependency policy already records two
npm 10.9 failures on this tree that npm 11 doesn't have.

## Decision

We will:

- **Pin npm 11.19.0** in `packageManager`: the npm the pinned Node ships, published 2026-07-29.
  Every CI job already installs the pinned npm (ADR 0008), so the floor job on Node 22.12 runs it
  too; npm 11 needs Node `^20.17.0 || >=22.9.0`.
- **Commit `.npmrc`** with `min-release-age=7` (Dependabot's wait), `allow-git=root`, and
  `allow-remote=root`.
- **Record each install script's review** in `package.json`'s `allowScripts` (npm 11's own
  mechanism): `true` lets it run, `false` stops it. Two packages in the tree have one. esbuild's
  postinstall is approved. fsevents' (macOS only) is `node-gyp rebuild`, and its tarball ships
  the built `fsevents.node` and no source to rebuild, so it's denied. npm 11 still runs a script
  `allowScripts` doesn't name, with a warning (`strict-allow-scripts` is off by default), so the
  list records decisions; it doesn't yet enforce them.
- **Hold every Node repository to the same** with `node.install-guards`: npm's three settings and
  an npm that reads them (11.15 or later), or pnpm's equivalents (`minimumReleaseAge`,
  `blockExoticSubdeps`).

Verified (executed): the lockfile is unchanged under npm 11.19.0; a clean `npm ci` and the full
`npm run check` pass with it; with this `.npmrc`, resolving `nanoid@^6` picks 6.0.1 over 6.0.2,
published three days earlier; and a transitive tarball-URL dependency fails with `EALLOWREMOTE`.
fsevents' script was read, not run: no macOS here.

## Alternatives considered

### Alternative: `allow-git=none`

Stricter, and npm 12's default. It lost because a project sometimes depends on a fork by git URL
on purpose, and `root` still refuses every git dependency a dependency brings in, which is the
route the TanStack payload took. A project that never wants one can set `none`.

### Alternative: npm 11.21.0, the newest 11.x past the cooldown

It's newer. It lost on matching: 11.19.0 is what the pinned Node bundles, so a contributor on
`.nvmrc` runs exactly the pinned npm without installing it. Move the pin when `.nvmrc`'s Node
bundles a newer one.

### Alternative: npm 12

`allow-git=none` and `allow-remote=none` by default. It lost because npm 12 needs Node
`^22.22.2 || ^24.15.0 || >=26.0.0`, which drops the 22.12 floor that ADR 0008 keeps for Vite and
Vitest. Revisit when the floor moves.

## Consequences

- **Easier:** a release younger than a week never lands through a casual `npm install`, and a
  dependency can't pull code from a git host behind the registry's back.
- **Harder:** taking an urgent fix younger than the wait is a deliberate act:
  `npm install <pkg>@<version> --min-release-age=0` (or the same flag on `npm audit fix`), with the
  diff reviewed. Whether Dependabot's own npm honors `.npmrc`'s `min-release-age` for a security
  update is unverified; if a security pull request can't resolve a fix younger than seven days,
  take it by hand that way.
- **Revisit** when the floor reaches Node 22.22.2 (npm 12 becomes possible), and if npm starts
  blocking unreviewed install scripts by default.
