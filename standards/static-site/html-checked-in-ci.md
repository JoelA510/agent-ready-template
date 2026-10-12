---
id: static-site.html-checked-in-ci
title: CI validates the HTML and checks its links
severity: medium
enforcement: check
audit-area: 6
---

**Requires:** a `pull_request` workflow runs an HTML validator or a link checker over the pages:
`html-validate`, `htmlhint`, the Nu validator (`vnu`), `lychee`, `linkinator`, `htmltest`, or
`htmlproofer`.

**Why:** a static site has no tests by default, so the first sign of a broken link, a missing
image, or a page the build dropped is a visitor finding it. A link checker run on the built output
catches all three, offline, in seconds.

**Meeting it:** `npx html-validate "dist/**/*.html"` and `lychee --offline dist` after the build,
in the job that runs on pull requests.

**The check:** looks for one of those commands in what `pull_request` workflows run, traced through
scripts the way `node.ci-runs-gate` is, and counted only where it can fail the run: not with
`--exit-zero` or `--exit-zero-always`. The `lycheeverse/lychee-action` step counts too, unless it's
set to `fail: false`, which reports broken links and passes; that's v1's default, so a v1 step (by
its tag, or by the `# v1...` comment beside a SHA) counts only with `fail: true`.
