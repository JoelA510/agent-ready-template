---
id: writing.prose-checks-in-ci
title: A prose check runs on every pull request
severity: medium
enforcement: check
audit-area: 12
---

**Requires:** a `pull_request` workflow runs a prose check: `markdownlint` or `markdownlint-cli2`,
`cspell`, `vale`, `textlint`, or the repository's own checker (a `check_*.py` or `check-*` script
it keeps that reads Markdown).

**Why:** the rules a writing repository keeps (American spelling, a phrase list, line width) are
only rules where something fails when they're broken. Run by hand, they're skipped on the day it
matters, and the drift shows up chapters later.

**Meeting it:** a workflow on `pull_request` that runs the checker against the changed files, for
example `python3 tools/check_log.py --diff origin/main`, or `npx markdownlint-cli2 "**/*.md"`.

**The check:** looks for one of those commands in what `pull_request` workflows run, traced through
scripts and counted only where it can fail the run: not with `--no-exit` or `--no-exit-code`. A run
that checks nothing doesn't count either: a version, help, or init flag alone, `vale sync`,
`ls-*`, or `test`, and cspell's `trace`, `suggestions`, `init`, `link`, or `dictionaries`. The
repository's own checker counts when the script is in the repository and mentions Markdown
(`.md`, `.mdx`, `markdown`), so another kind of check script doesn't; a path from
`$GITHUB_WORKSPACE` or `${{ github.workspace }}` is read from the root, and one through any other
variable is reported as unresolved. The markdownlint-cli2 action
counts, and the cspell action unless `strict: false`; `vale-cli/vale-action` counts only with a
`fail_level` other than `none`, or with `fail_on_error: true` and no `fail_level`, because by
default it reports and passes.
