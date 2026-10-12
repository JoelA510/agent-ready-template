---
id: python.tests-in-ci
title: Python tests exist and run in CI
severity: high
enforcement: check
audit-area: 6
---

**Requires:** test files (`test_*.py`, `*_test.py`, or files under a `tests/` directory), run in a
`pull_request` workflow by `pytest`, `python -m unittest`, `tox`, `nox`, or a step that runs a test
file directly.

**Why:** the definition of done requires tests with the change, and a suite that only runs by hand
stops being run.

**Meeting it:** `uv run pytest` (or `python -m unittest`) in a CI job that installs from the lockfile.

**The check:** lists test files under the project's path, then looks for a test command
(`pytest`, `python -m unittest`, `tox`, `nox`, directly or behind `uv run`, `poetry run`, and the
like) in the commands `pull_request` workflows run, where it can fail the run. `pip install pytest`
installs it; it doesn't run it.
