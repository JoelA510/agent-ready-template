---
id: python.audit-gate
title: CI checks the Python dependencies for advisories, on pull requests and on a schedule
severity: high
enforcement: check
audit-area: 8
---

**Requires:** the declared Python dependencies are audited in a `pull_request` workflow, in a step
that can fail it, and in a workflow with a `schedule` trigger.

**Why:** a Python dependency with a published advisory installs and runs as happily as a fixed one.
Nothing in the tests notices; an audit does. Advisories are published against code that has
already merged, so without the schedule a repository with no open pull requests never hears about
them.

**Meeting it:** `pip-audit -r requirements.txt` (or `pip-audit` in an environment the lockfile
installed), `uv audit`, or, for a repository with more than one ecosystem,
`osv-scanner scan source -r .`, which reads every lockfile in one run and whose `osv-scanner.toml`
is one waiver register for all of them (`core.audit-waivers`).

**The check:** applies when the pack's path declares third-party dependencies (a `pyproject.toml`
with dependencies beyond Python itself, a `Pipfile`, a non-empty `requirements*.txt` or
`requirements/*.txt`, or a lockfile). Looks for
`pip-audit` (or `python -m pip_audit`), `uv audit`, `osv-scanner`, or `safety check`/`safety scan`
in what each kind of workflow runs, traced through scripts and wrappers (`uvx`, `pipx run`), and
counted only where it can fail the run; or the `pypa/gh-action-pip-audit` or
`google/osv-scanner-action` actions, or OSV-Scanner's reusable workflows, except with
`internal-be-careful-allow-failure: true` or `fail-on-vuln: false`. It doesn't read which
files the audit is pointed at: an `osv-scanner` run scoped to another ecosystem's lockfile counts.
