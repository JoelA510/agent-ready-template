# 0013. The component registry is published with Storybook, and its items link by URL

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** template maintainers
- **Applies to:** `scripts/build-registry.mjs` and its outputs (`registry.json`, `public/r/`),
  `package.json`'s `homepage`, `scripts/check-pages-homepage.mjs`,
  `.github/workflows/pages.yml`, and `npm run init --homepage`.

## Context

- **The registry had never been installable.** Its served items listed each file's path without
  its content, and named dependencies by bare name (`"button"`). Read in the shadcn CLI 4.21
  source and shown with `shadcn add` against a local copy (executed 2026-09-24):
  - a file without `content` is skipped in silence, so `alert-dialog.tsx` was never written;
  - a bare name resolves against shadcn's own registry, so the stock shadcn `button.tsx` and
    `utils.ts` were installed in place of this repo's;
  - the command exited 0 throughout.
- **Nothing hosted it.** The Storybook build already copies `public/` (so `r/*.json`) into the
  site, but no workflow published the site.
- **Hosting has plan limits.** On GitHub Free, Pages (like rulesets) works only in a public
  repository.

## Decision

- **Each served item inlines its files' source**, and names each dependency on another item by
  that item's absolute URL under `package.json`'s `homepage`. `registry.json` keeps paths (the
  `shadcn build` input shape) with the same URL dependencies.
- **The Pages workflow publishes Storybook with the registry at `r/`** on every push to `main`.
  It deploys nothing, with a notice, until Pages' source is GitHub Actions. Before deploying, it
  refuses a registry built for another address (`check-pages-homepage.mjs`) and runs the drift
  gate; after, it checks the live site carries this run's marker and serves a registry item
  byte for byte as built.
- **The homepage belongs to the repository that serves it.** This repo's is its Pages URL.
  `init` without `--homepage` removes the template's own (and only that) from a fork, so the
  fork's registry falls back to the example.com placeholder instead of installing the
  template's components.
- **One reading of the homepage** (`scripts/homepage.mjs`) for `init`, the registry build, and
  the Pages check: an http(s) directory URL, with a trailing slash added and any query,
  fragment, page name, or credentials refused. npm's usual `…/repo#readme` would otherwise
  resolve every dependency URL outside the repo's path, in silence.

## Alternatives considered

### Alternative: a namespaced registry (`@acme/button`)

The shadcn CLI resolves `@namespace/name` through a `registries` entry in the consumer's
`components.json`, so items wouldn't embed a host. It lost because every consumer would have to
configure that entry before the first install, and a missing entry fails there, not here. URL
dependencies work with no consumer setup, and the workflow guarantees the host they name.

### Alternative: build the registry at deploy time with the Pages URL

The committed files would stay host-free. It lost because the committed `public/r/` is also
what `check:generated` and the tests verify; a deploy-only variant would publish files no gate
had examined.

### Alternative: deploy only after CI passes (`workflow_run`)

It would stop a red commit on `main` from publishing. It lost for now because `main` only moves
by pull request once the ruleset is imported, and the workflow runs the checks that bear on
what it publishes (the drift gate, the homepage check, the served item) itself.

## Consequences

- **Easier:** `npx shadcn@latest add <site>/r/<name>.json` installs this repo's component and its
  dependencies, byte for byte (executed against a local copy).
- **Harder:**
  - `public/r/` is about 210 KB of committed JSON (209,121 bytes, measured 2026-09-24) that
    changes with every component edit, and `npm run test` fails until `npm run registry:build`
    is rerun.
  - The registry works only from the site its `homepage` names; moving the site means
    rebuilding the registry.
- **Revisit** if consumers need to install from a mirror, which would favor the namespaced form.
