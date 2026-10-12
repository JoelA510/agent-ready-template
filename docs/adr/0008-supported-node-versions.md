# 0008. Pin the active Node LTS, support the maintained lines, and test the floor

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** template maintainers
- **Applies to:** `.nvmrc`, `package.json` (`engines`, `packageManager`), `.github/workflows/`,
  `scripts/runtime.mjs`, and the runtime guidance the prompts give target projects

## Context

The template pinned Node 22 in `.nvmrc` and declared `^20.19.0 || >=22.12.0` in `engines`.
Four facts had moved underneath that:

- **Node 20 reached end of life on 2026-04-30** (nodejs/Release `schedule.json`). `engines` still
  admitted it, and so did the odd-numbered 23 and 25, which end within months of release.
- **CI ran one version.** A newer-only API used in a script would pass CI on the pin and fail on
  the oldest version `engines` promises. Nothing ran the floor.
- **The package manager drifted with the runtime.** `packageManager` pins npm 10.9.7, but CI
  installed whatever npm came with Node. Node 24 bundles npm 11.
- **The sibling repos show the cost.** One ran CI on Node 20 while its host ran 24, with
  the difference written down as intentional. No sibling had a pinned runtime file at all.

## Decision

We will:

- **Pin the active LTS** in `.nvmrc`. That's 24, supported until 2028-04-30. Every workflow
  reads that file; none names its own version.
- **Declare only supported lines in `engines`:** `^22.12.0 || ^24.0.0 || >=26.0.0`. 22.12 is the
  floor Vite 8 and Vitest 4 need, and 22 is maintained until 2027-04-30. When a line ends, drop
  it here.
- **Run the tests on the floor too.** A second CI job runs `npm run test` on exactly the lowest
  version `engines` accepts. It's the one job allowed to name a version.
- **Install the pinned npm in every CI job**, read from `packageManager`, instead of the one that
  came with Node.
- **Refuse an unsupported runtime early** where a partial run does harm: `process:apply` checks
  `engines` before it writes anything.

`scripts/runtime.mjs` reads the `engines` forms used here (`||`-joined `^X.Y.Z` and `>=X.Y.Z`)
and throws on any other form, so a new form fails loudly instead of being misread.
`scripts/__tests__/repo-hygiene.test.ts` reads each workflow step by step and holds all of the
above. Each rule was shown failing against a planted defect: a hard-coded `node-version`, a
`node:20` job container, a missing npm pin step, a floor job off by one minor, and an `.nvmrc`
below the floor.

Verified before the switch (executed): a clean `npm ci`, the full `npm run check`, and
`check:generated` on Node 24.21.0; `npm run test` on 22.12.0; and `process:apply` on 20.19.5,
which exits 2 having written nothing.

## Alternatives considered

### Alternative: keep Node 22 as the pin

It's still maintained. It lost because it leaves maintenance support in seven months, while 24
is the active line with support to 2028. A template people fork today should start on the line
they'll keep longest.

### Alternative: `engines: >=24`, one version, no floor job

This is simpler: one version everywhere, and nothing to hold equal. It lost because 22 is a
maintained LTS that Vite and Vitest support, and forks shouldn't be told to upgrade a runtime the
tools don't require. The cost of keeping it honest is one short CI job.

### Alternative: a full version matrix (22, 24, 26) running the whole gate

This gives the most coverage. It lost on cost: the Storybook build and lint don't vary by
runtime in ways the tests miss, and the floor job already catches newer-only APIs. Add 26 to the
matrix when it becomes the LTS pin.

## Consequences

- **Easier:** a contributor, CI, and a fork all run the same Node and npm, and a runtime the
  package doesn't support is refused rather than half-working.
- **Harder:** CI takes one more job. Moving the pin is now a three-part change (`.nvmrc`,
  `engines`, and the floor job when the floor moves), and the hygiene test fails until all three
  agree.
- **Revisit** when Node 26 becomes LTS (2026-10-28) and when 22 reaches end of life
  (2027-04-30).
