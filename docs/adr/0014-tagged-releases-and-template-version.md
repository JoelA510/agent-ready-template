# 0014. Projects take template updates from tagged releases

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** template maintainers
- **Applies to:** `package.json`'s `version` and `templateVersion`, `CHANGELOG.md` release
  headings, the `v<version>` tags, `npm run init`, and
  `docs/system/updating-from-the-template.mdx`.

## Context

- **A project built from the template owns its copy.** Before this, nothing said how it picks
  up a later fix, which version it started from, or what a change asks of it.
- **Projects arrive three ways:**
  - forked or cloned, sharing the template's history;
  - made with GitHub's "Use this template", with no shared history;
  - given the process with `process:apply`, which already records a manifest and re-applies
    safely.
- **The template had no releases.** `version` stayed at 0.1.0, and the whole CHANGELOG sat in
  its Unreleased section.

## Decision

- **The template releases by tag,** `v<version>`, with a dated CHANGELOG heading of the same
  version. A test holds `package.json`, the lockfile, and the newest heading equal.
- **A project takes a release, never `main`, as one merge.** The template's tags are fetched
  into a `template/` namespace, so they can't collide with the project's own `v*` tags, and the
  release is merged with `--no-commit` so the CHANGELOG and generated files are handled before
  anything is committed.
  - A fork or clone shares history and merges directly.
  - A "Use this template" repository first grafts its first commit onto the template commit with
    the identical tree (`git replace --graft`), once. The merge commit then joins the histories,
    so later updates merge directly and the graft comes off.
  - A repository that received only the process re-runs `process:apply`.

  Run on scratch repositories: a project started between releases, its own `v1.0.0` tag, a
  rebranded line the release changes, a rebranded file the release deletes, a new binary file,
  and a second release merged without the graft.
- **`init` records `templateVersion`** (the version the template named when the project started)
  and restarts `version` at 0.1.0, on its first run only. It tells a project where to start
  reading the CHANGELOG; the merge finds the exact starting commit itself.
- **1.0.0 ships as a release candidate first,** until it has been tried on a new repository
  and an existing one.

## Alternatives considered

### Alternative: projects track `main`

It needs no releases. It lost because `main` has no statement of what a change asks of a
project, and a half-landed series of changes would reach projects mid-way.

### Alternative: apply the diff between two tags (`git diff | git apply --3way`)

It needs no history. It lost on review: a release that deletes a file the project edited, or
adds a binary, makes `git apply` reject the whole patch, and a project started between releases
gets changes it already has applied again. A real merge has none of those failure modes.

### Alternative: no `templateVersion`; find the starting point from git alone

The merge already does, for the diff it applies. It lost only as the whole answer, because a
person still has to know which CHANGELOG entries to read, and a version says that in a way a
commit hash doesn't.

## Consequences

- **Easier:** a project can say which template release it's on, read exactly the CHANGELOG
  entries that concern it, and take an update as one reviewable pull request.
- **Harder:**
  - Each release needs its CHANGELOG entries written for projects, and a tag pushed by hand
    (`CONTRIBUTING.md` §8).
  - Lines `init` rebranded conflict on every update that touches them, and lines a release adds
    arrive with the placeholder name (the guide says how to find them).
- **Revisit** if projects end up needing updates more often than releases come, or if a
  package-based distribution (for the components) replaces copying.
